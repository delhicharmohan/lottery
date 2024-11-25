require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Default environment variables if not provided
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/image-processor';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
process.env.SMTP_PORT = process.env.SMTP_PORT || '465';
process.env.SMTP_USER = process.env.SMTP_USER || 'your-email@gmail.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'your-app-specific-password';
process.env.SMTP_FROM = process.env.SMTP_FROM || 'your-email@gmail.com';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'your-gemini-api-key';

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Generate API key function
const generateApiKey = () => {
  return 'key_' + crypto.randomBytes(16).toString('hex');
};

// User model
const userProfileSchema = new mongoose.Schema({
  apiKey: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  isAdmin: { type: Boolean, default: false },
  requestCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const UserProfile = mongoose.model('UserProfile', userProfileSchema);

// Transaction model
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserProfile' },
  date: String,
  utr: String,
  amount_in_inr: String,
  createdAt: { type: Date, default: Date.now },
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Log Schema
const logSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserProfile' },
  timestamp: { 
    type: Date, 
    default: Date.now,
    expires: 864000 // 10 days in seconds
  },
  processingData: {
    date: { type: String, default: 'N/A' },
    utr: { type: String, default: 'N/A' },
    amount_in_inr: { type: String, default: 'N/A' },
    is_edited: { type: Boolean, default: false }
  }
});

const Log = mongoose.model('Log', logSchema);

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Simple in-memory rate limiter
const createUserRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 30 requests per minute
  keyGenerator: (req) => req.user._id.toString(),
  handler: (req, res) => {
    const resetTime = new Date(Date.now() + 60 * 1000);
    res.status(429).json({
      error: 'Too many requests, please try again in a minute.',
      requestsRemaining: 0,
      resetTime: resetTime.toISOString()
    });
  },
  skip: (req) => req.user && req.user.isAdmin
});

// Add rate limit headers middleware
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (body) {
    try {
      // Only set rate limit headers if rate limit info exists
      if (this.rateLimit) {
        // Ensure we have valid numbers for the headers
        const remaining = Math.max(0, this.rateLimit.remaining || 0);
        const resetTime = new Date(Date.now() + (this.rateLimit.resetTime || 60000));

        this.setHeader('X-RateLimit-Limit', '30');
        this.setHeader('X-RateLimit-Remaining', remaining.toString());
        this.setHeader('X-RateLimit-Reset', resetTime.toISOString());
      }
      
      return originalSend.call(this, body);
    } catch (error) {
      console.error('Error setting rate limit headers:', error);
      return originalSend.call(this, body);
    }
  };
  next();
});
// Authentication middleware
const authenticateUser = async (req, res, next) => {
  const userApiKey = req.headers['x-api-key'];
  if (!userApiKey) {
    return res.status(401).json({ error: 'Unauthorized: API key required' });
  }

  try {
    const user = await UserProfile.findOne({ apiKey: userApiKey });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Server error during authentication' });
  }
};

// Admin middleware
const requireAdmin = async (req, res, next) => {
  try {
    const user = await UserProfile.findById(req.user._id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Configure Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Gemini API configuration
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Image processing function
async function processImage(imageBuffer) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const generationConfig = {
      temperature: 0.1,
      topP: 0.1,
      topK: 1,
      maxOutputTokens: 8192,
      responseMimeType: "text/plain",
    };

    const rawTextPrompt = `
      Analyze the provided image and extract ALL text visible in it.
      Include any numbers, dates, transaction details, and any other relevant information.
      Provide the extracted text as a single, unformatted string.
    `;

    const requestParts = {
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: imageBuffer.toString('base64')
            }
          },
          { text: rawTextPrompt }
        ]
      }],
      generationConfig
    };

    const result = await model.generateContent(requestParts);
    const response = await result.response;
    const rawText = response.text().trim();

    const twelveDigitRegex = /\b\d{12}\b/g;
    const utrMatches = rawText.match(twelveDigitRegex) || [];

    const dataExtractionPrompt = `
      Extract the following details from the given text:
      - Date
      - 12-digit numeric code (UTR number)
      - Amount in INR (remove commas but keep decimal point)
      - Check for signs of image editing
      
      Rules:
      - For UTR, prefer 12-digit numbers starting with 4
      - If multiple 12-digit numbers found, list them all
      - Remove commas from amount and keep decimal point
      - Check carefully for signs of editing
      
      Return ONLY a JSON object in this format:
      {
        "date": "[extracted_date]",
        "utr": "[12-digit_utr]",
        "amount_in_inr": "[formatted_amount]",
        "is_edited": [true/false]
      }
    `;

    const dataExtractionResult = await model.generateContent({
      contents: [{ 
        parts: [{ text: dataExtractionPrompt + '\n\nText to analyze:\n' + rawText }]
      }],
      generationConfig
    });

    const extractionResponse = await dataExtractionResult.response;
    let extractedDataText = extractionResponse.text();
    let jsonMatch = extractedDataText.match(/\{[\s\S]*\}/);
    let extractedData = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Failed to extract structured data from the text.' };

    if (extractedData.amount_in_inr) {
      const amount = parseFloat(extractedData.amount_in_inr.replace(/,/g, ''));
      
      if (amount > 100000) {
        const surroundingText = rawText.slice(Math.max(0, rawText.indexOf(extractedData.amount_in_inr) - 50), 
          Math.min(rawText.length, rawText.indexOf(extractedData.amount_in_inr) + extractedData.amount_in_inr.length + 50));

        const amountVerificationPrompt = `
          The extracted amount is ${amount}. Considering the surrounding text, is this amount correct, or is it off by a factor of 10 (too high or too low)? If incorrect, what is the correct amount?

          Surrounding Text:
          \`\`\`
          ${surroundingText}
          \`\`\`

          Return ONLY a number or "correct" if the amount is accurate. If the extracted amount is not found in the surrounding text, return "not found".
        `;

        const verificationResult = await model.generateContent({
          contents: [{
            parts: [{ text: amountVerificationPrompt }]
          }],
          generationConfig
        });

        const verificationResponse = await verificationResult.response;
        const verifiedAmountText = verificationResponse.text().trim();

        let verifiedAmount;
        if (verifiedAmountText.toLowerCase() === 'correct') {
          verifiedAmount = amount;
        } else if (verifiedAmountText.toLowerCase() === 'not found') {
          verifiedAmount = amount;
        } else {
          verifiedAmount = parseFloat(verifiedAmountText);
        }

        if (!isNaN(verifiedAmount)) {
          extractedData.amount_in_inr = verifiedAmount.toFixed(2);
        }
      }
    }

    if (utrMatches.length > 0) {
      if (!extractedData.utr || !utrMatches.includes(extractedData.utr)) {
        const utrWith4 = utrMatches.find(num => num.startsWith('4'));
        extractedData.utr = utrWith4 || utrMatches[0];
        if (utrMatches.length > 1) {
          extractedData.utr_alternatives = utrMatches.filter(utr => utr !== extractedData.utr);
        }
      }
    }
    return extractedData;
  } catch (error) {
    console.error('Error processing image:', error);
    return { error: 'An error occurred while processing the image.' };
  }
}

// Admin endpoints
app.post('/api/admin/users', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { name, email } = req.body;
    const apiKey = generateApiKey();
    
    const newUser = new UserProfile({
      name,
      email,
      apiKey
    });
    
    await newUser.save();

    const mailOptions = {
      from: process.env.SMTP_FROM,
      to: email,
      subject: 'Your API Key',
      html: `
        <h1>Welcome ${name}!</h1>
        <p>Your API key has been generated:</p>
        <p><strong>${apiKey}</strong></p>
        <p>Please keep this key secure and do not share it with others.</p>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({ 
      success: true, 
      message: 'User created and email sent',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        apiKey: newUser.apiKey
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Error creating user' });
  }
});

app.get('/api/admin/users', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const users = await UserProfile.find({ isAdmin: false })
      .select('-__v')
      .sort('-createdAt');

    const usersWithCounts = await Promise.all(users.map(async user => {
      const requestCount = await Log.countDocuments({ userId: user._id });
      return {
        id: user._id,
        name: user.name,
        email: user.email,
        apiKey: user.apiKey,
        requestCount,
        createdAt: user.createdAt
      };
    }));

    res.json({ success: true, data: usersWithCounts });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

// Image processing endpoint
app.post('/api/process-image', 
  authenticateUser,
  createUserRateLimiter,
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }

      const user = req.user;
      const imageBuffer = req.file.buffer;

      const extractedData = await processImage(imageBuffer);

      if (extractedData.error) {
        return res.status(500).json({ error: extractedData.error });
      }

      if (extractedData.utr && extractedData.utr.length !== 12) {
        extractedData.utr = 'N/A'; 
      }
      // Save transaction
      const transaction = new Transaction({
        userId: user._id,
        date: extractedData.date,
        utr: extractedData.utr,
        amount_in_inr: extractedData.amount_in_inr,
      });
      await transaction.save();

      // Create log entry
      const log = new Log({
        userId: user._id,
        processingData: {
          date: extractedData.date || 'N/A',
          utr: extractedData.utr || 'N/A',
          amount_in_inr: extractedData.amount_in_inr || 'N/A',
          is_edited: extractedData.is_edited || false
        }
      });
      await log.save();

      // Increment request count
      await UserProfile.findByIdAndUpdate(user._id, { $inc: { requestCount: 1 } });

      // Calculate reset time
      const resetTime = new Date(Date.now() + 60000);

      // Send response
      res.json({
        success: true,
        data: extractedData,
        rateLimit: {
          remaining: Math.max(0, (req.rateLimit?.remaining || 0)),
          resetTime: resetTime.toISOString()
        }
      });
    } catch (error) {
      console.error('Error processing image:', error);
      res.status(500).json({ error: 'An error occurred while processing the image.' });
    }
});

// Logs retrieval endpoint
app.get('/api/logs', authenticateUser, async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      page = 1, 
      limit = 10 
    } = req.query;

    const query = {
      userId: req.user._id
    };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setDate(endDateTime.getDate() + 1);
        query.timestamp.$lte = endDateTime;
      }
    }

    const logs = await Log.find(query)
      .populate('userId', 'name')
      .sort({ timestamp: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await Log.countDocuments(query);

    const formattedLogs = logs.map(log => ({
      timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A',
      username: log.userId?.name || 'Unknown User',
      data: log.processingData || {
        date: 'N/A',
        utr: 'N/A',
        amount_in_inr: 'N/A',
        is_edited: false
      }
    }));

    res.json({
      success: true,
      data: {
        logs: formattedLogs,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error retrieving logs:', error);
    res.status(500).json({ error: 'An error occurred while retrieving logs.' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy'
    }
  });
});

// Create default admin user
async function createDefaultAdmin() {
  try {
    const adminExists = await UserProfile.findOne({ isAdmin: true });
    if (!adminExists) {
      const adminUser = new UserProfile({
        name: 'Admin',
        email: process.env.SMTP_FROM,
        apiKey: generateApiKey(),
        isAdmin: true
      });
      await adminUser.save();
      console.log('Default admin created with API key:', adminUser.apiKey);
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'An unexpected error occurred',
    requestId: req.id
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Starting graceful shutdown...');
  
  // Close MongoDB connection
  await mongoose.connection.close();
  
  // Close Express server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  
  // Force close after 10s
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
});

// Create server instance
const server = app.listen(process.env.PORT || 3000, async () => {
  try {
    await createDefaultAdmin();
    console.log(`Server running on port ${process.env.PORT || 3000}`);
  } catch (error) {
    console.error('Error during server startup:', error);
    process.exit(1);
  }
});

module.exports = { app, server }; // Export for testing
  
