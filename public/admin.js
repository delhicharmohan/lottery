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
            const response = await fetch('/api/admin/users', {
                headers: {
                    'X-API-Key': apiKeyInput.value
                }
            });

            const result = await response.json();

            if (result.success) {
                // Update stats
                const totalUsers = result.data.length;
                const totalRequests = result.data.reduce((sum, user) => sum + user.requestCount, 0);
                const activeToday = result.data.filter(user => {
                    const today = new Date().toDateString();
                    const userDate = new Date(user.lastRequest).toDateString();
                    return today === userDate;
                }).length;

                document.getElementById('totalUsers').textContent = totalUsers;
                document.getElementById('totalRequests').textContent = totalRequests;
                document.getElementById('activeToday').textContent = activeToday;

                // Update table
                const usersTableBody = document.getElementById('usersTableBody');
                usersTableBody.innerHTML = result.data.map(user => `
                    <tr class="hover:bg-gray-50">
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm font-medium text-gray-900">${user.name}</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm text-gray-500">${user.email}</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm font-mono text-gray-500">${user.apiKey}</div>
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
            } else {
                showToast(result.error || 'Error loading users', 'error');
            }
        } catch (error) {
            showToast('Error loading users', 'error');
            console.error('Error:', error);
        } finally {
            hideLoading();
        }
    }

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