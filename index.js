require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

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
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-8b" });

    const rawTextPrompt = `
      Analyze the image and extract ALL text visible in it. 
      Include any numbers, dates, transaction details, and any other relevant information.
      Provide the extracted text as a single, unformatted string.
    `;

    const rawTextParts = [
      { text: rawTextPrompt },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBuffer.toString('base64')
        }
      }
    ];

    const rawTextResult = await model.generateContent(rawTextParts);
    const rawTextResponse = await rawTextResult.response;
    const rawText = rawTextResponse.text().trim();

    const dataExtractionPrompt = `
      Extract the following details from the given text:
      - Date
      - 12-digit numeric code starting with 4
      - Amount in INR (remove commas and check if it has decimal point)
      Validate if the text suggests the image has been edited in any way.
      Return ONLY the JSON object in this format:
      {
        "date": "[extracted_date]",
        "utr": "[12-digit_utr]",
        "amount_in_inr": "[formatted_amount]",
        "is_edited": [true/false]
      }
    `;

    const dataExtractionResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: dataExtractionPrompt + '\n\nText to analyze:\n' + rawText }]}]
    });
    const dataExtractionResponse = await dataExtractionResult.response;
    let extractedDataText = dataExtractionResponse.text();

    let jsonMatch = extractedDataText.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Failed to extract structured data from the text.' };
  } catch (error) {
    console.error('Error processing image:', error);
    return { error: 'An error occurred while processing the image.' };
  }
}

// Create default admin user if none exists
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
app.post('/api/process-image', authenticateUser, upload.single('image'), async (req, res) => {
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

    // Send the response
    res.json({ success: true, data: extractedData });
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
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create default admin and start server
async function initializeServer() {
  await createDefaultAdmin();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

initializeServer();