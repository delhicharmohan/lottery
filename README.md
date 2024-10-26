#API Documentation

## Overview
This API provides OCR (Optical Character Recognition) services for processing images containing transaction details. It supports user management, image processing, and logging capabilities.

## Base URL
```
http://base-url
```

## Authentication
All API endpoints require authentication using an API key. Include your API key in the request headers:
```
X-API-Key: your_api_key_here
```

## Endpoints

### Image Processing

#### Process Single Image
```http
POST /api/process-image
```

**Request Headers:**
```
Content-Type: multipart/form-data
X-API-Key: your_api_key_here
```

**Request Body:**
- `image`: Image file (JPEG/PNG, max 5MB)

**Response:**
```json
{
  "success": true,
  "data": {
    "date": "12 Jun 2024",
    "utr": "453065310100",
    "amount_in_inr": "2500.00",
    "is_edited": false
  }
}
```

**Error Response:**
```json
{
  "error": "Error message here"
}
```


## Sample Code

### cURL
```bash
# Process an image
curl -X POST \
  -H "X-API-Key: your_api_key" \
  -F "image=@transaction.jpg" \
  http://base-url/api/process-image

```

### Python
```python
import requests

API_KEY = 'your_api_key'
BASE_URL = 'http://base-url'

def process_image(image_path):
    headers = {'X-API-Key': API_KEY}
    files = {'image': open(image_path, 'rb')}
    response = requests.post(
        f'{BASE_URL}/api/process-image',
        headers=headers,
        files=files
    )
    return response.json()
```

### JavaScript
```javascript
async function processImage(imageFile) {
  const formData = new FormData();
  formData.append('image', imageFile);

  const response = await fetch('http://base-url/api/process-image', {
    method: 'POST',
    headers: {
      'X-API-Key': 'your_api_key'
    },
    body: formData
  });

  return await response.json();
}
```

## Support
For issues or queries, contact the development team at delhicharmohan@gmail.com

## Updates and Changes
API version: 1.0.0
Last updated: October 26, 2024
