document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const imageFile = document.getElementById('imageInput').files[0];
    const apiKey = document.getElementById('apiKeyInput').value;
    const outputElement = document.getElementById('output');

    if (!imageFile) {
        outputElement.textContent = 'Please select an image file.';
        return;
    }

    const formData = new FormData();
    formData.append('image', imageFile);

    try {
        const response = await fetch('/api/process-image', {
            method: 'POST',
            headers: {
                'X-API-Key': apiKey
            },
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            // Create a formatted output string
            let outputString = '';
            if (result.data) {
                outputString += `Date: ${result.data.date || 'N/A'}\n`;
                outputString += `Transaction ID: ${result.data.transaction_id || 'N/A'}\n`;
                outputString += `Amount (INR): ${result.data.amount_in_inr || 'N/A'}\n`;
                outputString += `Is Edited: ${result.data.is_edited !== undefined ? result.data.is_edited : 'N/A'}\n\n`;
            } else {
                outputString = JSON.stringify(result, null, 2);
            }
            outputElement.textContent = outputString;
        } else {
            outputElement.textContent = `Error: ${result.error}`;
        }
    } catch (error) {
        outputElement.textContent = `Error: ${error.message}`;
    }
});

document.getElementById('processFolderBtn').addEventListener('click', () => {
    const output = document.getElementById('folderOutput');
    const progressBar = document.getElementById('progressBar').firstElementChild;
    output.textContent = '';
    progressBar.style.width = '0%';

    const eventSource = new EventSource('/process-folder');

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch(data.type) {
            case 'init':
            case 'status':
                output.textContent += `${data.message}\n`;
                break;
            case 'start':
                output.textContent += `Starting to process ${data.total} images...\n`;
                break;
            case 'progress':
                const percent = (data.processed / data.total) * 100;
                progressBar.style.width = percent + '%';
                output.textContent += `Processed ${data.file}: ${JSON.stringify(data.result)}\n`;
                break;
            case 'complete':
                output.textContent += `${data.message}\n`;
                eventSource.close();
                break;
            case 'error':
                output.textContent += `Error: ${data.message}\n`;
                if (data.file) {
                    const percent = (data.processed / data.total) * 100;
                    progressBar.style.width = percent + '%';
                }
                break;
        }
        // Scroll to the bottom of the output
        output.scrollTop = output.scrollHeight;
    };

    eventSource.onerror = () => {
        output.textContent += 'Error: Lost connection to server.\n';
        eventSource.close();
    };
});
