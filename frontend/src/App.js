import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// Get backend URL from environment
const BACKEND_URL = process.env.REACT_APP_API_URL || 'http://localhost:8001';

function App() {
  // Main state
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [showPasswordRegister, setShowPasswordRegister] = useState(false);

  // Data state
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [tasksData, setTasksData] = useState([]);
  const [notificationsData, setNotificationsData] = useState([]);
  const [supportedCurrencies, setSupportedCurrencies] = useState({});
  const [adminDashboard, setAdminDashboard] = useState(null);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminTasks, setAdminTasks] = useState([]);

  // Form states
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    referralCode: ''
  });

  const [profileForm, setProfileForm] = useState({
    preferred_currency: 'USD',
    theme: 'light',
    notifications_enabled: true
  });

  const [adminForms, setAdminForms] = useState({
    sendBalance: { user_id: '', amount: '', reason: '' },
    createTask: {
      title: '',
      description: '',
      reward: '',
      type: 'one_time',
      requirements: '',
      verification_type: 'manual',
      external_url: ''
    },
    broadcast: { title: '', message: '', type: 'info', priority: 'medium' },
    grantToken: { user_id: '', token_name: '' },
    boostToken: { token_id: '' }
  });

  // Initialize app
  useEffect(() => {
    // Check for dark mode preference
    const savedTheme = localStorage.getItem('profitpilot_theme');
    if (savedTheme) {
      setDarkMode(savedTheme === 'dark');
    }

    // Check for existing token
    const token = localStorage.getItem('profitpilot_token');
    const isReturningUser = localStorage.getItem('profitpilot_returning_user');
    
    if (token) {
      fetchDashboard(token);
      if (!isReturningUser) {
        setShowWelcomePopup(true);
        localStorage.setItem('profitpilot_returning_user', 'true');
      }
    } else {
      setShowAuth(true);
    }

    // Fetch supported currencies
    fetchSupportedCurrencies();
  }, []);

  // Apply dark mode to document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('profitpilot_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Auto refresh data
  useEffect(() => {
    if (currentUser && !showAuth) {
      const interval = setInterval(() => {
        fetchDashboard();
        if (activeTab === 'notifications') {
          fetchNotifications();
        }
      }, 30000); // Refresh every 30 seconds

      return () => clearInterval(interval);
    }
  }, [currentUser, showAuth, activeTab]);

  // API Functions
  const fetchDashboard = async (token = null) => {
    try {
      setLoading(true);
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/dashboard`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setDashboardData(response.data);
      setCurrentUser(response.data.user);
      setProfileForm({
        preferred_currency: response.data.user.preferred_currency || 'USD',
        theme: response.data.user.theme || 'light',
        notifications_enabled: response.data.user.notifications_enabled !== false
      });
      setDarkMode(response.data.user.theme === 'dark');
      setShowAuth(false);
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      if (error.response?.status === 401) {
        localStorage.removeItem('profitpilot_token');
        setShowAuth(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchSupportedCurrencies = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/currencies`);
      setSupportedCurrencies(response.data);
    } catch (error) {
      console.error('Failed to fetch currencies:', error);
    }
  };

  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotificationsData(response.data.notifications || []);
    } catch (error) {
      console.error('Notifications fetch error:', error);
    }
  };

  const fetchTasks = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTasksData(response.data.tasks || []);
    } catch (error) {
      console.error('Tasks fetch error:', error);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/leaderboard`);
      setLeaderboardData(response.data);
    } catch (error) {
      console.error('Leaderboard fetch error:', error);
    }
  };

  const fetchAdminDashboard = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminDashboard(response.data);
    } catch (error) {
      console.error('Admin dashboard fetch error:', error);
    }
  };

  const fetchAdminUsers = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminUsers(response.data.users || []);
    } catch (error) {
      console.error('Admin users fetch error:', error);
    }
  };

  const fetchAdminTasks = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminTasks(response.data.tasks || []);
    } catch (error) {
      console.error('Admin tasks fetch error:', error);
    }
  };

  // Authentication
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
      const payload = authMode === 'login' 
        ? { email: authForm.email, password: authForm.password }
        : { email: authForm.email, password: authForm.password, referral_code: authForm.referralCode };
      
      const response = await axios.post(`${BACKEND_URL}${endpoint}`, payload);
      
      localStorage.setItem('profitpilot_token', response.data.access_token);
      await fetchDashboard(response.data.access_token);
      
      if (authMode === 'register') {
        setShowWelcomePopup(true);
        localStorage.setItem('profitpilot_returning_user', 'true');
      }
      
      setAuthForm({ email: '', password: '', referralCode: '' });
    } catch (error) {
      alert(error.response?.data?.detail || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('profitpilot_token');
    setCurrentUser(null);
    setDashboardData(null);
    setShowAuth(true);
    setActiveTab('dashboard');
    setSidebarOpen(false);
  };

  // Profile Management
  const updateProfile = async (updates) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/profile/update`, updates, {
        headers: { Authorization: `Bearer ${token}` }
      });
      await fetchDashboard();
      showNotification('Profile updated successfully!', 'success');
    } catch (error) {
      showNotification('Failed to update profile', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Task Management
  const completeTask = async (taskId) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(`${BACKEND_URL}/api/tasks/complete`, 
        { task_id: taskId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification(`Task completed! Earned ${response.data.currency} ${response.data.reward_converted}`, 'success');
      await fetchTasks();
      await fetchDashboard();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to complete task', 'error');
    } finally {
      setLoading(false);
    }
  };

  const markNotificationRead = async (notificationId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/notifications/${notificationId}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      await fetchNotifications();
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  // Payment handling
  const handlePayment = async (action, tokenId = null) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      
      const response = await axios.post(
        `${BACKEND_URL}/api/payment/initialize`,
        { action, token_id: tokenId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.authorization_url) {
        window.location.href = response.data.authorization_url;
      }
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Payment initialization failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Admin Functions
  const adminSendBalance = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/admin/workspace/send-balance`, adminForms.sendBalance, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification('Balance sent successfully!', 'success');
      setAdminForms({...adminForms, sendBalance: { user_id: '', amount: '', reason: '' }});
      await fetchAdminUsers();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to send balance', 'error');
    } finally {
      setLoading(false);
    }
  };

  const adminCreateTask = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const taskData = {
        ...adminForms.createTask,
        reward: parseFloat(adminForms.createTask.reward)
      };
      await axios.post(`${BACKEND_URL}/api/admin/workspace/create-task`, taskData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification('Task created successfully!', 'success');
      setAdminForms({...adminForms, createTask: {
        title: '', description: '', reward: '', type: 'one_time',
        requirements: '', verification_type: 'manual', external_url: ''
      }});
      await fetchAdminTasks();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to create task', 'error');
    } finally {
      setLoading(false);
    }
  };

  const adminBroadcast = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/admin/workspace/broadcast`, adminForms.broadcast, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification('Broadcast sent successfully!', 'success');
      setAdminForms({...adminForms, broadcast: { title: '', message: '', type: 'info', priority: 'medium' }});
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to send broadcast', 'error');
    } finally {
      setLoading(false);
    }
  };

  const adminGrantToken = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/admin/workspace/users/grant-token`, adminForms.grantToken, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification('Token granted successfully!', 'success');
      setAdminForms({...adminForms, grantToken: { user_id: '', token_name: '' }});
      await fetchAdminUsers();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to grant token', 'error');
    } finally {
      setLoading(false);
    }
  };

  const adminBoostToken = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/admin/workspace/users/boost-token`, adminForms.boostToken, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification('Token boosted successfully!', 'success');
      setAdminForms({...adminForms, boostToken: { token_id: '' }});
      await fetchAdminUsers();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to boost token', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Utility functions
  const showNotification = (message, type = 'info') => {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 3000);
  };

  const formatCurrency = (amount, currency = 'USD') => {
    const currencyInfo = supportedCurrencies.currencies?.[currency];
    const symbol = currencyInfo?.symbol || '$';
    return `${symbol}${parseFloat(amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  const copyReferralLink = () => {
    const referralLink = `${window.location.origin}?ref=${currentUser.referral_code}`;
    navigator.clipboard.writeText(referralLink);
    showNotification('Referral link copied to clipboard!', 'success');
  };

  const formatTimeUntilWithdrawal = (eligibleDate) => {
    if (!eligibleDate) return 'Loading...';
    
    const now = new Date();
    const eligible = new Date(eligibleDate);
    const diff = eligible - now;
    
    if (diff <= 0) return 'Eligible now!';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    return `${days} days, ${hours} hours`;
  };

  // Tab switching with data fetching
  const handleTabSwitch = (tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
    
    // Fetch data based on tab
    switch (tab) {
      case 'tasks':
        fetchTasks();
        break;
      case 'notifications':
        fetchNotifications();
        break;
      case 'leaderboard':
        fetchLeaderboard();
        break;
      case 'workspace':
        if (currentUser?.is_admin) {
          fetchAdminDashboard();
          fetchAdminUsers();
          fetchAdminTasks();
        }
        break;
    }
  };

  // Auth Screen
  if (showAuth) {
    return (
      <div className={`min-h-screen ${darkMode ? 'dark bg-gray-900' : 'bg-gradient-to-br from-blue-600 to-purple-700'} flex items-center justify-center p-4`}>
        <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-2xl shadow-2xl w-full max-w-md p-8 fade-in`}>
          <div className="text-center mb-8">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bounce-in">
              <span className="text-white text-2xl font-bold">P</span>
            </div>
            <h1 className={`text-3xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>ProfitPilot</h1>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mt-2`}>Professional Crypto Earnings Platform</p>
          </div>

          <div className="flex mb-6">
            <button
              className={`flex-1 py-2 px-4 rounded-l-lg font-medium transition-colors btn-hover ${
                authMode === 'login' 
                  ? 'bg-blue-600 text-white' 
                  : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`
              }`}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              className={`flex-1 py-2 px-4 rounded-r-lg font-medium transition-colors btn-hover ${
                authMode === 'register' 
                  ? 'bg-blue-600 text-white' 
                  : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`
              }`}
              onClick={() => setAuthMode('register')}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div className="form-group">
              <input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                className={`form-input ${
                  darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                }`}
                required
              />
            </div>
            <div className="relative form-group">
              <input
                type={authMode === 'login' ? (showPasswordLogin ? 'text' : 'password') : (showPasswordRegister ? 'text' : 'password')}
                placeholder="Password"
                value={authForm.password}
                onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                className={`form-input pr-10 ${
                  darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                }`}
                required
              />
              <button
                type="button"
                onClick={() => authMode === 'login' ? setShowPasswordLogin(!showPasswordLogin) : setShowPasswordRegister(!showPasswordRegister)}
                className={`absolute right-3 top-1/2 transform -translate-y-1/2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} hover:opacity-70`}
              >
                {(authMode === 'login' ? showPasswordLogin : showPasswordRegister) ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            {authMode === 'register' && (
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Referral Code (Optional)"
                  value={authForm.referralCode}
                  onChange={(e) => setAuthForm({...authForm, referralCode: e.target.value})}
                  className={`form-input ${
                    darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                  }`}
                />
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity btn-hover"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="loading-dots">
                    <div></div><div></div><div></div><div></div>
                  </div>
                </div>
              ) : (authMode === 'login' ? 'Login' : 'Register')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'} hover:opacity-70 transition-opacity`}
            >
              {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
      {/* Welcome Popup */}
      {showWelcomePopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-2xl p-8 max-w-md w-full relative bounce-in`}>
            <button
              onClick={() => setShowWelcomePopup(false)}
              className={`absolute top-4 right-4 ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'} text-xl transition-colors`}
            >
              ✕
            </button>
            <div className="text-center">
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-glow">
                <span className="text-white text-2xl">🎉</span>
              </div>
              <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4`}>
                Welcome to ProfitPilot!
              </h2>
              <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
                Your crypto earning journey starts now. Your first token is already mining and will generate earnings every 2 hours!
              </p>
              <button
                onClick={() => setShowWelcomePopup(false)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity btn-hover"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Header */}
      <header className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} shadow-sm border-b lg:hidden`}>
        <div className="px-4 py-3 flex justify-between items-center">
          <div className="flex items-center">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} p-2 hover:opacity-70 transition-opacity`}
            >
              ☰
            </button>
            <div className="ml-2 flex items-center">
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-8 h-8 rounded-full flex items-center justify-center shadow-glow">
                <span className="text-white text-sm font-bold">P</span>
              </div>
              <span className={`ml-2 text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>ProfitPilot</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg px-2 py-1`}>
              <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {formatCurrency(currentUser?.total_earnings_converted || 0, currentUser?.preferred_currency)}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className={`${darkMode ? 'text-red-400' : 'text-red-600'} text-sm p-1 hover:opacity-70 transition-opacity`}
            >
              🚪
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-40 w-64 ${
          darkMode ? 'bg-gray-800' : 'bg-white'
        } border-r ${darkMode ? 'border-gray-700' : 'border-gray-200'} transition-transform duration-300 ease-in-out lg:transition-none overflow-y-auto slide-in-left`}>
          
          {/* Sidebar Header */}
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center shadow-glow">
                  <span className="text-white text-lg font-bold">P</span>
                </div>
                <div className="ml-3">
                  <span className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>ProfitPilot</span>
                  <span className="ml-2 text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full font-medium badge badge-success">PRO</span>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className={`lg:hidden ${darkMode ? 'text-gray-400' : 'text-gray-600'} hover:opacity-70 transition-opacity`}
              >
                ✕
              </button>
            </div>
          </div>

          {/* User Info */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3 glass-effect`}>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center shadow-glow">
                  <span className="text-white font-bold">{currentUser?.email?.[0]?.toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-800'} truncate`}>
                    {currentUser?.user_id}
                  </p>
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'} truncate`}>
                    {currentUser?.email}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className={`${darkMode ? 'bg-gray-600' : 'bg-white'} rounded p-2 text-center card-hover`}>
                  <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Balance</p>
                  <p className={`font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                    {formatCurrency(currentUser?.total_earnings_converted || 0, currentUser?.preferred_currency)}
                  </p>
                </div>
                <div className={`${darkMode ? 'bg-gray-600' : 'bg-white'} rounded p-2 text-center card-hover`}>
                  <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Tokens</p>
                  <p className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                    {currentUser?.tokens_owned || 0}/5
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="p-4 space-y-2">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: '📊' },
              { id: 'tokens', label: 'Tokens', icon: '🪙' },
              { id: 'tasks', label: 'Tasks', icon: '🎯' },
              { id: 'notifications', label: 'Notifications', icon: '🔔' },
              { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
              { id: 'profile', label: 'Profile', icon: '👤' },
              ...(currentUser?.is_admin ? [{ id: 'workspace', label: 'Workspace', icon: '💼' }] : [])
            ].map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => handleTabSwitch(id)}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-all duration-200 btn-hover ${
                  activeTab === id
                    ? 'bg-blue-600 text-white shadow-glow'
                    : `${darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100'}`
                }`}
              >
                <span className="text-lg">{icon}</span>
                <span className="font-medium">{label}</span>
                {id === 'notifications' && notificationsData.filter(n => !n.read).length > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-2 py-1 loading-pulse">
                    {notificationsData.filter(n => !n.read).length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Theme Toggle */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => {
                setDarkMode(!darkMode);
                updateProfile({ theme: !darkMode ? 'dark' : 'light' });
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors btn-hover ${
                darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              <span className="flex items-center space-x-2">
                <span>{darkMode ? '☀️' : '🌙'}</span>
                <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
              </span>
              <div className="toggle-switch">
                <input type="checkbox" checked={darkMode} readOnly />
                <span className="toggle-slider"></span>
              </div>
            </button>
          </div>

          {/* Logout */}
          <div className="p-4">
            <button
              onClick={handleLogout}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors btn-hover ${
                darkMode ? 'text-red-400 hover:bg-gray-700' : 'text-red-600 hover:bg-red-50'
              }`}
            >
              <span>🚪</span>
              <span>Logout</span>
            </button>
          </div>
        </aside>

        {/* Overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <main className="flex-1 lg:ml-0">
          <div className="p-4 lg:p-8">
            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && dashboardData && (
              <div className="space-y-6 fade-in">
                {/* Welcome Header */}
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl text-white p-6 lg:p-8 card-hover shadow-glow">
                  <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start">
                    <div className="flex-1">
                      <h1 className="text-2xl lg:text-3xl font-bold mb-2 heading-2">
                        Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}
                      </h1>
                      <p className="text-blue-100 mb-6 body-regular">Here's your portfolio performance today</p>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div>
                          <p className="text-blue-200 text-sm mb-1">Total Balance</p>
                          <p className="text-3xl lg:text-4xl font-bold text-gradient">
                            {formatCurrency(dashboardData.stats.total_balance_converted, currentUser.preferred_currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-blue-200 text-sm mb-1">Mining Rate</p>
                          <p className="text-3xl lg:text-4xl font-bold">
                            {formatCurrency(dashboardData.stats.mining_rate_converted, currentUser.preferred_currency)}/2h
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 lg:mt-0">
                      <div className="bg-white bg-opacity-20 rounded-lg p-3 glass-effect">
                        <span className="text-2xl">✨</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-green-50'} rounded-xl p-6 card-hover`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-green-500 rounded-lg p-2 shadow-glow">
                        <span className="text-white text-lg">💰</span>
                      </div>
                      <span className="text-green-600 text-sm font-medium badge badge-success">Total</span>
                    </div>
                    <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-sm mb-1 caption`}>Total Earnings</p>
                    <p className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} heading-3`}>
                      {formatCurrency(currentUser.total_earnings_converted, currentUser.preferred_currency)}
                    </p>
                  </div>

                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-blue-50'} rounded-xl p-6 card-hover`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-blue-500 rounded-lg p-2 shadow-glow">
                        <span className="text-white text-lg">🪙</span>
                      </div>
                      <span className="text-blue-600 text-sm font-medium badge badge-info">{currentUser.tokens_owned}/5</span>
                    </div>
                    <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-sm mb-1 caption`}>Active Tokens</p>
                    <p className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} heading-3`}>{currentUser.tokens_owned}</p>
                  </div>

                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-purple-50'} rounded-xl p-6 card-hover`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-purple-500 rounded-lg p-2 shadow-glow">
                        <span className="text-white text-lg">👥</span>
                      </div>
                      <span className="text-purple-600 text-sm font-medium badge">
                        {formatCurrency(currentUser.referral_earnings_converted, currentUser.preferred_currency)} earned
                      </span>
                    </div>
                    <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-sm mb-1 caption`}>Referrals</p>
                    <p className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} heading-3`}>{currentUser.referrals_count}</p>
                  </div>

                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-orange-50'} rounded-xl p-6 card-hover`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-orange-500 rounded-lg p-2 shadow-glow">
                        <span className="text-white text-lg">⚡</span>
                      </div>
                      <span className="text-orange-600 text-sm font-medium badge badge-warning">Total</span>
                    </div>
                    <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-sm mb-1 caption`}>Boosts Used</p>
                    <p className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} heading-3`}>{currentUser.boosts_used}</p>
                  </div>
                </div>

                {/* Referral Section */}
                <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                  <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>🤝 Referral Program</h3>
                  <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-4 mb-4 glass-effect`}>
                    <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-2 caption`}>Your referral code:</p>
                    <div className="flex items-center space-x-2">
                      <code className={`${darkMode ? 'bg-gray-600 text-white' : 'bg-gray-200'} px-3 py-1 rounded text-sm font-mono border-gradient`}>
                        {currentUser.referral_code}
                      </code>
                      <button
                        onClick={copyReferralLink}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors btn-hover"
                      >
                        Copy Link
                      </button>
                    </div>
                  </div>
                  <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} body-small`}>
                    Earn {formatCurrency(2, currentUser.preferred_currency)} for each person who joins with your code!
                  </p>
                </div>

                {/* Withdrawal Timer */}
                <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                  <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>💸 Withdrawal Status</h3>
                  <div className={`${darkMode ? 'bg-yellow-900' : 'bg-yellow-50'} rounded-lg p-4 glass-effect`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>Time until withdrawal eligible:</p>
                        <p className={`text-2xl font-bold ${darkMode ? 'text-yellow-400' : 'text-yellow-600'} heading-2`}>
                          {formatTimeUntilWithdrawal(currentUser.withdrawal_eligible_at)}
                        </p>
                      </div>
                      <div className={`${darkMode ? 'text-yellow-400' : 'text-yellow-500'} text-3xl loading-pulse`}>⏰</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tokens Tab */}
            {activeTab === 'tokens' && dashboardData && (
              <div className="space-y-6 fade-in">
                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center">
                  <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 lg:mb-0 heading-2`}>🪙 Your Tokens</h2>
                  <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} body-regular`}>Manage your mining tokens and earnings</p>
                </div>

                {currentUser.tokens_owned < 5 && (
                  <div className={`${darkMode ? 'bg-blue-900' : 'bg-blue-50'} rounded-xl p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 heading-3`}>Add More Tokens</h3>
                    <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4 body-regular`}>
                      Expand your mining capacity with additional tokens ({formatCurrency(5, currentUser.preferred_currency)} each)
                    </p>
                    <button
                      onClick={() => handlePayment('token')}
                      disabled={loading}
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors btn-hover"
                    >
                      {loading ? (
                        <div className="loading-dots"><div></div><div></div><div></div><div></div></div>
                      ) : (
                        `+ Add Token (${formatCurrency(5, currentUser.preferred_currency)})`
                      )}
                    </button>
                  </div>
                )}

                <div className="grid gap-6">
                  {dashboardData.tokens.map((token) => (
                    <div key={token.token_id} className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start mb-4">
                        <div className="mb-4 lg:mb-0">
                          <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} heading-3`}>{token.name}</h3>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>
                            Created: {new Date(token.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="text-left lg:text-right">
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>Boost Level</p>
                          <p className={`text-2xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'} heading-2`}>{token.boost_level}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                        <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3`}>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>Total Earned</p>
                          <p className={`text-lg font-semibold ${darkMode ? 'text-green-400' : 'text-green-600'} body-large`}>
                            {formatCurrency(token.total_earnings_converted, currentUser.preferred_currency)}
                          </p>
                        </div>
                        <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3`}>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>Income Per Cycle</p>
                          <p className={`text-lg font-semibold ${darkMode ? 'text-blue-400' : 'text-blue-600'} body-large`}>
                            {formatCurrency(token.hourly_rate_converted, currentUser.preferred_currency)}/2h
                          </p>
                        </div>
                        <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3`}>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>Next Boost Cost</p>
                          <p className={`text-lg font-semibold ${darkMode ? 'text-orange-400' : 'text-orange-600'} body-large`}>
                            {formatCurrency(3 * Math.pow(2, token.boost_level), currentUser.preferred_currency)}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handlePayment('boost', token.token_id)}
                        disabled={loading || token.boost_level >= 10}
                        className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-2 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity btn-hover"
                      >
                        {loading ? (
                          <div className="loading-dots"><div></div><div></div><div></div><div></div></div>
                        ) : (
                          `⚡ Boost Token (${formatCurrency(3 * Math.pow(2, token.boost_level), currentUser.preferred_currency)})`
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks Tab */}
            {activeTab === 'tasks' && (
              <div className="space-y-6 fade-in">
                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center">
                  <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 lg:mb-0 heading-2`}>🎯 Available Tasks</h2>
                  <button
                    onClick={fetchTasks}
                    disabled={loading}
                    className={`${darkMode ? 'text-blue-400' : 'text-blue-600'} hover:opacity-70 disabled:opacity-50 transition-opacity btn-hover`}
                  >
                    🔄 Refresh
                  </button>
                </div>

                {loading ? (
                  <div className="text-center py-12 empty-state">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className={`mt-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'} body-regular`}>Loading tasks...</p>
                  </div>
                ) : tasksData.length === 0 ? (
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-8 text-center empty-state`}>
                    <div className="empty-state-icon">🎯</div>
                    <h3 className={`empty-state-title ${darkMode ? 'text-white' : 'text-gray-800'}`}>No tasks available</h3>
                    <p className={`empty-state-description ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Check back later for new earning opportunities!</p>
                  </div>
                ) : (
                  <div className="grid gap-6">
                    {tasksData.map((task) => (
                      <div key={task.task_id} className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover border-gradient`}>
                        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start mb-4">
                          <div className="flex-1 mb-4 lg:mb-0">
                            <div className="flex items-center space-x-2 mb-2">
                              <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} heading-3`}>{task.title}</h3>
                              <span className={`badge ${
                                task.type === 'daily' ? 'badge-success' :
                                task.type === 'one_time' ? 'badge-info' :
                                'badge'
                              }`}>
                                {task.type.replace('_', ' ')}
                              </span>
                              {task.verification_type === 'external' && (
                                <span className="badge badge-warning">
                                  External
                                </span>
                              )}
                            </div>
                            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-2 body-regular`}>{task.description}</p>
                            {task.requirements && (
                              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} body-small`}>
                                <strong>Requirements:</strong> {task.requirements}
                              </p>
                            )}
                            {task.external_url && (
                              <p className={`text-sm ${darkMode ? 'text-blue-400' : 'text-blue-600'} mt-2 body-small`}>
                                🔗 <a href={task.external_url} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70 transition-opacity">
                                  Complete this task
                                </a>
                              </p>
                            )}
                          </div>
                          <div className="text-left lg:text-right">
                            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>Reward</p>
                            <p className={`text-2xl font-bold ${darkMode ? 'text-green-400' : 'text-green-600'} heading-2 text-gradient`}>
                              {formatCurrency(task.reward_converted, task.currency)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center">
                          <div className="mb-4 lg:mb-0">
                            {task.expires_at && (
                              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>
                                Expires: {new Date(task.expires_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => completeTask(task.task_id)}
                            disabled={loading}
                            className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors btn-hover shadow-glow"
                          >
                            {loading ? (
                              <div className="loading-dots"><div></div><div></div><div></div><div></div></div>
                            ) : (
                              'Complete Task'
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Notifications Tab */}
            {activeTab === 'notifications' && (
              <div className="space-y-6 fade-in">
                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center">
                  <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 lg:mb-0 heading-2`}>🔔 Notifications</h2>
                  <button
                    onClick={fetchNotifications}
                    disabled={loading}
                    className={`${darkMode ? 'text-blue-400' : 'text-blue-600'} hover:opacity-70 disabled:opacity-50 transition-opacity btn-hover`}
                  >
                    🔄 Refresh
                  </button>
                </div>

                {loading ? (
                  <div className="text-center py-12 empty-state">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className={`mt-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'} body-regular`}>Loading notifications...</p>
                  </div>
                ) : notificationsData.length === 0 ? (
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-8 text-center empty-state`}>
                    <div className="empty-state-icon">🔔</div>
                    <h3 className={`empty-state-title ${darkMode ? 'text-white' : 'text-gray-800'}`}>No notifications</h3>
                    <p className={`empty-state-description ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>You're all caught up!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {notificationsData.map((notification) => (
                      <div
                        key={notification.notification_id}
                        className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-4 border-l-4 card-hover ${
                          notification.type === 'success' ? 'border-green-500' :
                          notification.type === 'error' ? 'border-red-500' :
                          notification.type === 'warning' ? 'border-yellow-500' :
                          'border-blue-500'
                        } ${!notification.read ? 'ring-2 ring-blue-500 ring-opacity-20 shadow-glow' : 'opacity-70'}`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <h4 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} heading-3`}>
                                {notification.title}
                              </h4>
                              {!notification.read && (
                                <span className="w-2 h-2 bg-blue-500 rounded-full loading-pulse"></span>
                              )}
                              <span className={`badge ${
                                notification.priority === 'high' ? 'badge-error' :
                                notification.priority === 'medium' ? 'badge-warning' :
                                'badge'
                              }`}>
                                {notification.priority}
                              </span>
                            </div>
                            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-2 body-regular`}>
                              {notification.message}
                            </p>
                            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>
                              {new Date(notification.created_at).toLocaleString()}
                            </p>
                          </div>
                          {!notification.read && (
                            <button
                              onClick={() => markNotificationRead(notification.notification_id)}
                              className={`text-sm ${darkMode ? 'text-blue-400' : 'text-blue-600'} hover:opacity-70 ml-4 transition-opacity btn-hover`}
                            >
                              Mark Read
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Leaderboard Tab */}
            {activeTab === 'leaderboard' && (
              <div className="space-y-6 fade-in">
                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center">
                  <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 lg:mb-0 heading-2`}>🏆 Leaderboard</h2>
                  <button
                    onClick={fetchLeaderboard}
                    disabled={loading}
                    className={`${darkMode ? 'text-blue-400' : 'text-blue-600'} hover:opacity-70 disabled:opacity-50 transition-opacity btn-hover`}
                  >
                    🔄 Refresh
                  </button>
                </div>
                
                {loading ? (
                  <div className="text-center py-12 empty-state">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className={`mt-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'} body-regular`}>Loading leaderboard...</p>
                  </div>
                ) : leaderboardData ? (
                  <div className="grid lg:grid-cols-2 gap-6">
                    <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>🥇 Top Earners</h3>
                      <div className="space-y-3">
                        {leaderboardData.top_earners.map((user, index) => (
                          <div key={user.user_id} className={`flex items-center justify-between p-3 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg card-hover glass-effect`}>
                            <div className="flex items-center space-x-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold shadow-glow ${
                                index === 0 ? 'bg-yellow-500' : 
                                index === 1 ? 'bg-gray-400' : 
                                index === 2 ? 'bg-orange-600' : 'bg-gray-300'
                              }`}>
                                {index + 1}
                              </div>
                              <div>
                                <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>{user.user_id}</p>
                                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>{user.email}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`font-semibold ${darkMode ? 'text-green-400' : 'text-green-600'} body-large`}>
                                {formatCurrency(user.total_earnings_converted, user.currency)}
                              </p>
                              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>{user.tokens_owned} tokens</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>⚡ Most Boosted Tokens</h3>
                      <div className="space-y-3">
                        {leaderboardData.top_tokens.map((token, index) => (
                          <div key={`${token.name}-${index}`} className={`flex items-center justify-between p-3 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg card-hover glass-effect`}>
                            <div className="flex items-center space-x-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold shadow-glow ${
                                index === 0 ? 'bg-yellow-500' : 
                                index === 1 ? 'bg-gray-400' : 
                                index === 2 ? 'bg-orange-600' : 'bg-gray-300'
                              }`}>
                                {index + 1}
                              </div>
                              <div>
                                <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>{token.name}</p>
                                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>Owner: {token.owner_id}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`font-semibold ${darkMode ? 'text-blue-400' : 'text-blue-600'} body-large`}>Level {token.boost_level}</p>
                              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>
                                {formatCurrency(token.total_earnings, 'USD')}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 empty-state">
                    <div className="empty-state-icon">🏆</div>
                    <h3 className={`empty-state-title ${darkMode ? 'text-white' : 'text-gray-800'}`}>Failed to load leaderboard</h3>
                    <p className={`empty-state-description ${darkMode ? 'text-gray-300' : 'text-gray-500'}`}>Please try refreshing the page</p>
                  </div>
                )}
              </div>
            )}

            {/* Profile Tab */}
            {activeTab === 'profile' && (
              <div className="space-y-6 fade-in">
                <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} heading-2`}>👤 Profile Settings</h2>
                
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Account Information */}
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>Account Information</h3>
                    <div className="space-y-4">
                      <div className="form-group">
                        <label className={`form-label ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>User ID</label>
                        <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>{currentUser?.user_id}</p>
                      </div>
                      <div className="form-group">
                        <label className={`form-label ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Email</label>
                        <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>{currentUser?.email}</p>
                      </div>
                      <div className="form-group">
                        <label className={`form-label ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Country</label>
                        <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>{currentUser?.country || 'Not set'}</p>
                      </div>
                      <div className="form-group">
                        <label className={`form-label ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Member Since</label>
                        <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>
                          {new Date(currentUser?.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Currency Settings */}
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>Currency Settings</h3>
                    <div className="space-y-4">
                      <div className="form-group">
                        <label className={`form-label ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          Preferred Currency
                        </label>
                        <select
                          value={profileForm.preferred_currency}
                          onChange={(e) => {
                            setProfileForm({...profileForm, preferred_currency: e.target.value});
                            updateProfile({ preferred_currency: e.target.value });
                          }}
                          className={`form-input ${
                            darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'
                          }`}
                        >
                          {Object.entries(supportedCurrencies.currencies || {}).map(([code, info]) => (
                            <option key={code} value={code}>
                              {info.flag} {code} - {info.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3 glass-effect`}>
                        <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-1 caption`}>Current Balance</p>
                        <p className={`text-xl font-bold ${darkMode ? 'text-green-400' : 'text-green-600'} body-large text-gradient`}>
                          {formatCurrency(currentUser?.total_earnings_converted || 0, currentUser?.preferred_currency)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Preferences */}
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>Preferences</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>Dark Mode</p>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'} caption`}>Toggle dark/light theme</p>
                        </div>
                        <div className="toggle-switch">
                          <input 
                            type="checkbox" 
                            checked={darkMode}
                            onChange={() => {
                              setDarkMode(!darkMode);
                              updateProfile({ theme: !darkMode ? 'dark' : 'light' });
                            }}
                          />
                          <span className="toggle-slider"></span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>Email Notifications</p>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'} caption`}>Receive mining and task updates</p>
                        </div>
                        <div className="toggle-switch">
                          <input 
                            type="checkbox" 
                            checked={profileForm.notifications_enabled}
                            onChange={() => {
                              const newValue = !profileForm.notifications_enabled;
                              setProfileForm({...profileForm, notifications_enabled: newValue});
                              updateProfile({ notifications_enabled: newValue });
                            }}
                          />
                          <span className="toggle-slider"></span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Statistics */}
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>Your Statistics</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3 text-center glass-effect`}>
                        <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} caption`}>Total Earnings</p>
                        <p className={`text-lg font-bold ${darkMode ? 'text-green-400' : 'text-green-600'} body-large`}>
                          {formatCurrency(currentUser?.total_earnings_converted || 0, currentUser?.preferred_currency)}
                        </p>
                      </div>
                      <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3 text-center glass-effect`}>
                        <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} caption`}>Referral Earnings</p>
                        <p className={`text-lg font-bold ${darkMode ? 'text-purple-400' : 'text-purple-600'} body-large`}>
                          {formatCurrency(currentUser?.referral_earnings_converted || 0, currentUser?.preferred_currency)}
                        </p>
                      </div>
                      <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3 text-center glass-effect`}>
                        <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} caption`}>Login Count</p>
                        <p className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'} body-large`}>
                          {currentUser?.login_count || 0}
                        </p>
                      </div>
                      <div className={`${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-lg p-3 text-center glass-effect`}>
                        <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} caption`}>Active Days</p>
                        <p className={`text-lg font-bold ${darkMode ? 'text-orange-400' : 'text-orange-600'} body-large`}>
                          {Math.floor((new Date() - new Date(currentUser?.created_at)) / (1000 * 60 * 60 * 24)) || 0}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Admin Workspace Tab */}
            {activeTab === 'workspace' && currentUser?.is_admin && (
              <div className="space-y-6 fade-in">
                <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} heading-2`}>💼 Admin Workspace</h2>
                
                {/* Dashboard Stats */}
                {adminDashboard && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 heading-3`}>Total Revenue</h3>
                      <p className={`text-3xl font-bold ${darkMode ? 'text-green-400' : 'text-green-600'} heading-2 text-gradient`}>
                        {formatCurrency(adminDashboard.revenue_metrics?.total_revenue || 0, 'USD')}
                      </p>
                      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>
                        Today: {formatCurrency(adminDashboard.revenue_metrics?.today_revenue || 0, 'USD')}
                      </p>
                    </div>
                    <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 heading-3`}>Total Users</h3>
                      <p className={`text-3xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'} heading-2`}>
                        {adminDashboard.user_metrics?.total_users || 0}
                      </p>
                      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>
                        Online: {adminDashboard.user_metrics?.users_online || 0}
                      </p>
                    </div>
                    <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 heading-3`}>Active Tokens</h3>
                      <p className={`text-3xl font-bold ${darkMode ? 'text-purple-400' : 'text-purple-600'} heading-2`}>
                        {adminDashboard.token_metrics?.active_tokens || 0}
                      </p>
                      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>
                        Purchased: {adminDashboard.token_metrics?.tokens_bought || 0}
                      </p>
                    </div>
                    <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2 heading-3`}>Active Tasks</h3>
                      <p className={`text-3xl font-bold ${darkMode ? 'text-orange-400' : 'text-orange-600'} heading-2`}>
                        {adminDashboard.task_metrics?.active_tasks || 0}
                      </p>
                      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} caption`}>
                        Completed Today: {adminDashboard.task_metrics?.completions_today || 0}
                      </p>
                    </div>
                  </div>
                )}

                {/* Admin Actions */}
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Send Balance */}
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>💰 Send Balance to User</h3>
                    <div className="space-y-4">
                      <input
                        type="text"
                        placeholder="User ID"
                        value={adminForms.sendBalance.user_id}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          sendBalance: { ...adminForms.sendBalance, user_id: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <input
                        type="number"
                        placeholder="Amount (USD)"
                        value={adminForms.sendBalance.amount}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          sendBalance: { ...adminForms.sendBalance, amount: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <input
                        type="text"
                        placeholder="Reason"
                        value={adminForms.sendBalance.reason}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          sendBalance: { ...adminForms.sendBalance, reason: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <button
                        onClick={adminSendBalance}
                        disabled={loading || !adminForms.sendBalance.user_id || !adminForms.sendBalance.amount}
                        className="w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors btn-hover shadow-glow"
                      >
                        {loading ? (
                          <div className="loading-dots"><div></div><div></div><div></div><div></div></div>
                        ) : (
                          'Send Balance'
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Grant Token */}
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>🪙 Grant Token to User</h3>
                    <div className="space-y-4">
                      <input
                        type="text"
                        placeholder="User ID"
                        value={adminForms.grantToken.user_id}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          grantToken: { ...adminForms.grantToken, user_id: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <input
                        type="text"
                        placeholder="Token Name (Optional)"
                        value={adminForms.grantToken.token_name}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          grantToken: { ...adminForms.grantToken, token_name: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <button
                        onClick={adminGrantToken}
                        disabled={loading || !adminForms.grantToken.user_id}
                        className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors btn-hover shadow-glow"
                      >
                        {loading ? (
                          <div className="loading-dots"><div></div><div></div><div></div><div></div></div>
                        ) : (
                          'Grant Token'
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Boost Token */}
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>⚡ Boost User Token</h3>
                    <div className="space-y-4">
                      <input
                        type="text"
                        placeholder="Token ID"
                        value={adminForms.boostToken.token_id}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          boostToken: { ...adminForms.boostToken, token_id: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <button
                        onClick={adminBoostToken}
                        disabled={loading || !adminForms.boostToken.token_id}
                        className="w-full bg-orange-600 text-white py-2 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 transition-colors btn-hover shadow-glow"
                      >
                        {loading ? (
                          <div className="loading-dots"><div></div><div></div><div></div><div></div></div>
                        ) : (
                          'Boost Token'
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Create Task */}
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>🎯 Create Task</h3>
                    <div className="space-y-4">
                      <input
                        type="text"
                        placeholder="Task Title"
                        value={adminForms.createTask.title}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          createTask: { ...adminForms.createTask, title: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <textarea
                        placeholder="Task Description"
                        value={adminForms.createTask.description}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          createTask: { ...adminForms.createTask, description: e.target.value }
                        })}
                        rows={3}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          placeholder="Reward (USD)"
                          value={adminForms.createTask.reward}
                          onChange={(e) => setAdminForms({
                            ...adminForms,
                            createTask: { ...adminForms.createTask, reward: e.target.value }
                          })}
                          className={`form-input ${
                            darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                          }`}
                        />
                        <select
                          value={adminForms.createTask.type}
                          onChange={(e) => setAdminForms({
                            ...adminForms,
                            createTask: { ...adminForms.createTask, type: e.target.value }
                          })}
                          className={`form-input ${
                            darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'
                          }`}
                        >
                          <option value="one_time">One Time</option>
                          <option value="daily">Daily</option>
                          <option value="repeatable">Repeatable</option>
                        </select>
                      </div>
                      <input
                        type="url"
                        placeholder="External URL (Optional)"
                        value={adminForms.createTask.external_url}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          createTask: { ...adminForms.createTask, external_url: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                        }`}
                      />
                      <button
                        onClick={adminCreateTask}
                        disabled={loading || !adminForms.createTask.title || !adminForms.createTask.description || !adminForms.createTask.reward}
                        className="w-full bg-purple-600 text-white py-2 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors btn-hover shadow-glow"
                      >
                        {loading ? (
                          <div className="loading-dots"><div></div><div></div><div></div><div></div></div>
                        ) : (
                          'Create Task'
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Broadcast Message */}
                <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                  <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>📢 Broadcast Message</h3>
                  <div className="grid lg:grid-cols-2 gap-4">
                    <input
                      type="text"
                      placeholder="Broadcast Title"
                      value={adminForms.broadcast.title}
                      onChange={(e) => setAdminForms({
                        ...adminForms,
                        broadcast: { ...adminForms.broadcast, title: e.target.value }
                      })}
                      className={`form-input ${
                        darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                      }`}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={adminForms.broadcast.type}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          broadcast: { ...adminForms.broadcast, type: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'
                        }`}
                      >
                        <option value="info">Info</option>
                        <option value="success">Success</option>
                        <option value="warning">Warning</option>
                        <option value="error">Error</option>
                      </select>
                      <select
                        value={adminForms.broadcast.priority}
                        onChange={(e) => setAdminForms({
                          ...adminForms,
                          broadcast: { ...adminForms.broadcast, priority: e.target.value }
                        })}
                        className={`form-input ${
                          darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'
                        }`}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>
                  <textarea
                    placeholder="Broadcast Message"
                    value={adminForms.broadcast.message}
                    onChange={(e) => setAdminForms({
                      ...adminForms,
                      broadcast: { ...adminForms.broadcast, message: e.target.value }
                    })}
                    rows={4}
                    className={`form-input mt-4 ${
                      darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300'
                    }`}
                  />
                  <button
                    onClick={adminBroadcast}
                    disabled={loading || !adminForms.broadcast.title || !adminForms.broadcast.message}
                    className="w-full bg-red-600 text-white py-2 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors mt-4 btn-hover shadow-glow"
                  >
                    {loading ? (
                      <div className="loading-dots"><div></div><div></div><div></div><div></div></div>
                    ) : (
                      'Send Broadcast'
                    )}
                  </button>
                </div>

                {/* Users List */}
                {adminUsers.length > 0 && (
                  <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-sm p-6 card-hover`}>
                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-800'} mb-4 heading-3`}>👥 All Users</h3>
                    <div className="overflow-x-auto">
                      <table className="data-table w-full">
                        <thead>
                          <tr>
                            <th className={`text-left p-3 ${darkMode ? 'text-gray-300 bg-gray-700' : 'text-gray-600 bg-gray-50'}`}>User ID</th>
                            <th className={`text-left p-3 ${darkMode ? 'text-gray-300 bg-gray-700' : 'text-gray-600 bg-gray-50'}`}>Email</th>
                            <th className={`text-left p-3 ${darkMode ? 'text-gray-300 bg-gray-700' : 'text-gray-600 bg-gray-50'}`}>Balance</th>
                            <th className={`text-left p-3 ${darkMode ? 'text-gray-300 bg-gray-700' : 'text-gray-600 bg-gray-50'}`}>Tokens</th>
                            <th className={`text-left p-3 ${darkMode ? 'text-gray-300 bg-gray-700' : 'text-gray-600 bg-gray-50'}`}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminUsers.slice(0, 10).map((user) => (
                            <tr key={user.user_id} className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'} transition-colors`}>
                              <td className={`p-3 ${darkMode ? 'text-white' : 'text-gray-800'} body-regular`}>{user.user_id}</td>
                              <td className={`p-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'} body-small`}>{user.email}</td>
                              <td className={`p-3 ${darkMode ? 'text-green-400' : 'text-green-600'} body-regular`}>
                                {formatCurrency(user.total_earnings || 0, 'USD')}
                              </td>
                              <td className={`p-3 ${darkMode ? 'text-blue-400' : 'text-blue-600'} body-regular`}>
                                {user.tokens_owned || 0}
                              </td>
                              <td className="p-3">
                                <span className={`badge ${
                                  user.online_status === 'online' 
                                    ? 'badge-success status-online' 
                                    : user.online_status === 'recently_active'
                                    ? 'badge-warning status-away'
                                    : 'badge status-offline'
                                }`}>
                                  {user.online_status === 'online' ? '🟢 Online' : 
                                   user.online_status === 'recently_active' ? '🟡 Recently Active' : '⚫ Offline'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
