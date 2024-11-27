document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKeyInput');
    const addUserBtn = document.getElementById('addUserBtn');
    const addUserModal = document.getElementById('addUserModal');
    const closeModal = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const addUserForm = document.getElementById('addUserForm');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const toast = document.getElementById('toast');
    
    // Initialize from localStorage
    apiKeyInput.value = localStorage.getItem('adminApiKey') || '';

    // Save API key to localStorage when changed
    apiKeyInput.addEventListener('change', () => {
        localStorage.setItem('adminApiKey', apiKeyInput.value);
        loadUsers(); // Reload users with new API key
    });

    // Modal controls
    addUserBtn.addEventListener('click', () => {
        if (!apiKeyInput.value) {
            showToast('Please enter your Admin API key', 'error');
            return;
        }
        addUserModal.classList.remove('hidden');
    });

    const hideModal = () => {
        addUserModal.classList.add('hidden');
        addUserForm.reset();
    };

    [closeModal, cancelBtn].forEach(btn => {
        btn.addEventListener('click', hideModal);
    });

    addUserModal.addEventListener('click', (e) => {
        if (e.target === addUserModal) {
            hideModal();
        }
    });

    // Toast notification function
    const showToast = (message, type = 'success') => {
        toast.textContent = message;
        toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg text-white transform transition-transform duration-300 ease-in-out ${
            type === 'error' ? 'bg-red-500' : 'bg-green-500'
        }`;
        toast.style.transform = 'translateY(0)';
        setTimeout(() => {
            toast.style.transform = 'translateY(100%)';
        }, 3000);
    };

    // Loading overlay controls
    const showLoading = () => loadingOverlay.classList.remove('hidden');
    const hideLoading = () => loadingOverlay.classList.add('hidden');

    // Add user form submission
    addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoading();

        const formData = new FormData(addUserForm);
        const userData = {
            name: formData.get('name'),
            email: formData.get('email')
        };

        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKeyInput.value
                },
                body: JSON.stringify(userData)
            });

            const result = await response.json();

            if (result.success) {
                hideModal();
                showToast('User created successfully');
                loadUsers();
            } else {
                showToast(result.error || 'Error creating user', 'error');
            }
        } catch (error) {
            showToast('Error creating user', 'error');
            console.error('Error:', error);
        } finally {
            hideLoading();
        }
    });

    // Load and display users
    async function loadUsers() {
        if (!apiKeyInput.value) return;
        
        showLoading();
        try {
            const dateFilter = document.getElementById('dateFilter').value;
            const response = await fetch(`/api/admin/users?dateFilter=${dateFilter}`, {
                headers: {
                    'X-API-Key': apiKeyInput.value
                }
            });

            const result = await response.json();

            if (result.success) {
                // Update stats based on filtered data
                const filteredUsers = result.data.filter(user => {
                    if (!dateFilter) return true;
                    return hasActivityInDateRange(user.lastRequest, dateFilter);
                });

                const totalRequests = filteredUsers.reduce((sum, user) => sum + user.requestCount, 0);
                const activeUsers = filteredUsers.length;

                document.getElementById('totalUsers').textContent = result.data.length;
                document.getElementById('totalRequests').textContent = totalRequests;
                document.getElementById('activeToday').textContent = activeUsers;

                // Update table with filtered data
                const usersTableBody = document.getElementById('usersTableBody');
                usersTableBody.innerHTML = filteredUsers.map(user => `
                    <tr class="hover:bg-gray-50">
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm font-medium text-gray-900">${user.name}</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm text-gray-500">${user.email}</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="flex items-center space-x-2">
                                <div class="text-sm font-mono bg-gray-100 px-3 py-1 rounded" id="apiKey-${user.id}">
                                    ${'•'.repeat(24)}
                                </div>
                                <button onclick="toggleApiKey('${user.id}', '${user.apiKey}')" 
                                    class="text-blue-500 hover:text-blue-700 focus:outline-none"
                                    title="Show/Hide API Key">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                        <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" />
                                    </svg>
                                </button>
                                <button onclick="copyApiKey('${user.id}', '${user.apiKey}')"
                                    class="text-gray-500 hover:text-gray-700 focus:outline-none"
                                    title="Copy API Key">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                                        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                                    </svg>
                                </button>
                            </div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm text-gray-500">${user.requestCount}</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm text-gray-500">
                                ${new Date(user.createdAt).toLocaleDateString()}
                            </div>
                        </td>
                    </tr>
                `).join('');
            }
        } catch (error) {
            showToast('Error loading users', 'error');
            console.error('Error:', error);
        } finally {
            hideLoading();
        }
    }

    function hasActivityInDateRange(lastRequest, dateFilter) {
        if (!lastRequest) return false;
        
        const date = new Date(lastRequest);
        const today = new Date();
        
        switch(dateFilter) {
            case 'today':
                return date.toDateString() === today.toDateString();
            case 'last7days':
                const last7Days = new Date(today);
                last7Days.setDate(last7Days.getDate() - 7);
                return date >= last7Days;
            case 'last30days':
                const last30Days = new Date(today);
                last30Days.setDate(last30Days.getDate() - 30);
                return date >= last30Days;
            case 'thisMonth':
                return date.getMonth() === today.getMonth() && 
                       date.getFullYear() === today.getFullYear();
            default:
                return true;
        }
    }

    // Add event listener for date filter changes
    document.getElementById('dateFilter').addEventListener('change', loadUsers);

    // Initial load
    if (apiKeyInput.value) {
        loadUsers();
    }

    // Refresh users every 30 seconds
    setInterval(() => {
        if (apiKeyInput.value) {
            loadUsers();
        }
    }, 30000);
});

function toggleApiKey(userId, apiKey) {
    const apiKeyElement = document.getElementById(`apiKey-${userId}`);
    const isHidden = apiKeyElement.textContent.includes('•');
    
    if (isHidden) {
        apiKeyElement.textContent = apiKey;
        apiKeyElement.classList.add('bg-blue-50', 'text-blue-700');
        apiKeyElement.classList.remove('bg-gray-100');
        
        // Auto-hide after 30 seconds
        setTimeout(() => {
            hideApiKey(userId);
        }, 30000);
    } else {
        hideApiKey(userId);
    }
}

function hideApiKey(userId) {
    const apiKeyElement = document.getElementById(`apiKey-${userId}`);
    apiKeyElement.textContent = '•'.repeat(24);
    apiKeyElement.classList.remove('bg-blue-50', 'text-blue-700');
    apiKeyElement.classList.add('bg-gray-100');
}

function copyApiKey(userId, apiKey) {
    navigator.clipboard.writeText(apiKey).then(() => {
        showToast('API Key copied to clipboard');
    }).catch(() => {
        showToast('Failed to copy API Key', 'error');
    });
}