import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// Get backend URL from environment
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [profileSubTab, setProfileSubTab] = useState('account');
  const [adminSubTab, setAdminSubTab] = useState('dashboard');
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [adminDashboard, setAdminDashboard] = useState(null);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminTasks, setAdminTasks] = useState([]);
  const [adminBroadcasts, setAdminBroadcasts] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [miningCountdown, setMiningCountdown] = useState('');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [userNotifications, setUserNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastEarnings, setLastEarnings] = useState(0);
  const [userTasks, setUserTasks] = useState([]);
  const [supportedCurrencies, setSupportedCurrencies] = useState({});
  const [theme, setTheme] = useState('light');

  // Auth form state
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    referralCode: ''
  });

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    preferred_currency: 'USD',
    theme: 'light',
    notifications_enabled: true
  });

  // Admin forms
  const [sendBalanceForm, setSendBalanceForm] = useState({
    user_id: '',
    amount: '',
    reason: ''
  });

  const [createTaskForm, setCreateTaskForm] = useState({
    title: '',
    description: '',
    reward: '',
    type: 'one_time',
    requirements: '',
    expires_at: '',
    verification_type: 'manual',
    external_url: ''
  });

  const [broadcastForm, setBroadcastForm] = useState({
    title: '',
    message: '',
    type: 'info',
    priority: 'medium'
  });

  // Theme effect
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Check for existing token and handle referral on app load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const referralCode = urlParams.get('ref');
    if (referralCode) {
      setAuthForm(prev => ({ ...prev, referralCode }));
      setAuthMode('register');
    }

    const reference = urlParams.get('reference');
    if (reference) {
      handlePaymentVerification(reference);
    }

    const token = localStorage.getItem('profitpilot_token');
    if (token) {
      fetchDashboard(token);
    } else {
      setShowAuth(true);
    }

    // Load supported currencies
    fetchSupportedCurrencies();
  }, []);

  // Auto-refresh dashboard data every 60 seconds
  useEffect(() => {
    if (!showAuth && currentUser) {
      const interval = setInterval(() => {
        fetchDashboard();
        if (!currentUser.is_admin) {
          fetchUserNotifications();
        }
      }, 60000);

      return () => clearInterval(interval);
    }
  }, [showAuth, currentUser]);

  // Check for earnings changes and show notification
  useEffect(() => {
    if (currentUser && lastEarnings > 0 && currentUser.total_earnings > lastEarnings) {
      const difference = currentUser.total_earnings - lastEarnings;
      showNotification(`🎉 Mining completed! You earned $${difference.toFixed(2)}!`, 'success');
    }
    if (currentUser) {
      setLastEarnings(currentUser.total_earnings);
    }
  }, [currentUser?.total_earnings]);

  // Mining countdown timer
  useEffect(() => {
    if (dashboardData?.next_mining) {
      const timer = setInterval(() => {
        const now = new Date();
        const nextMining = new Date(dashboardData.next_mining);
        const diff = nextMining - now;
        
        if (diff <= 0) {
          setMiningCountdown('Mining now! 🎉');
          setTimeout(() => fetchDashboard(), 5000);
        } else {
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          setMiningCountdown(`${hours}h ${minutes}m ${seconds}s`);
        }
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [dashboardData?.next_mining]);

  const fetchSupportedCurrencies = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/currencies`);
      setSupportedCurrencies(response.data.currencies);
    } catch (error) {
      console.error('Error fetching currencies:', error);
    }
  };

  const fetchDashboard = async (token = null) => {
    try {
      setLoading(true);
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/dashboard`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setDashboardData(response.data);
      setCurrentUser(response.data.user);
      setTheme(response.data.user.theme || 'light');
      setProfileForm({
        preferred_currency: response.data.user.preferred_currency || 'USD',
        theme: response.data.user.theme || 'light',
        notifications_enabled: response.data.user.notifications_enabled !== false
      });
      setShowAuth(false);
      
      if (response.data.user.tokens_owned === 1 && !localStorage.getItem('onboarding_completed')) {
        setShowOnboarding(true);
      }

      // Fetch notifications for users
      if (!response.data.user.is_admin) {
        fetchUserNotifications(authToken);
        fetchUserTasks(authToken);
      }
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      if (error.response?.status === 401) {
        localStorage.removeItem('profitpilot_token');
        setShowAuth(true);
      } else {
        showNotification('Failed to load dashboard data', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchUserNotifications = async (token = null) => {
    try {
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setUserNotifications(response.data.notifications);
      setUnreadCount(response.data.unread_count);
    } catch (error) {
      console.error('Notifications fetch error:', error);
    }
  };

  const fetchUserTasks = async (token = null) => {
    try {
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/tasks`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setUserTasks(response.data.tasks);
    } catch (error) {
      console.error('Tasks fetch error:', error);
    }
  };

  const markNotificationRead = async (notificationId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/notifications/${notificationId}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchUserNotifications();
    } catch (error) {
      console.error('Mark notification read error:', error);
    }
  };

  const completeTask = async (taskId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(`${BACKEND_URL}/api/tasks/complete`, 
        { task_id: taskId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification(response.data.message, 'success');
      fetchUserTasks();
      fetchDashboard();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to complete task', 'error');
    }
  };

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
      
      setAuthForm({ email: '', password: '', referralCode: '' });
      showNotification(`${authMode === 'login' ? 'Logged in' : 'Account created'} successfully!`, 'success');
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Authentication failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('profitpilot_token');
    localStorage.removeItem('onboarding_completed');
    setCurrentUser(null);
    setDashboardData(null);
    setShowAuth(true);
    setActiveTab('home');
    setTheme('light');
    showNotification('Logged out successfully', 'success');
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/profile/update`, profileForm, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setTheme(profileForm.theme);
      showNotification('Profile updated successfully!', 'success');
      fetchDashboard(); // Refresh to get updated data
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to update profile', 'error');
    } finally {
      setLoading(false);
    }
  };

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
      } else {
        showNotification('Payment initialization failed', 'error');
      }
    } catch (error) {
      console.error('Payment error:', error);
      showNotification(error.response?.data?.detail || 'Payment initialization failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentVerification = async (reference) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(
        `${BACKEND_URL}/api/payment/verify`,
        { reference },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      showNotification('Payment successful! 🎉', 'success');
      fetchDashboard();
      
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      showNotification('Payment verification failed', 'error');
    }
  };

  // ============================================================================
  // ADMIN FUNCTIONS
  // ============================================================================

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
      setAdminUsers(response.data.users);
    } catch (error) {
      console.error('Admin users fetch error:', error);
    }
  };

  const fetchUserDetails = async (userId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedUser(response.data);
    } catch (error) {
      console.error('User details fetch error:', error);
    }
  };

  const fetchAdminTasks = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminTasks(response.data.tasks);
    } catch (error) {
      console.error('Admin tasks fetch error:', error);
    }
  };

  const fetchAdminBroadcasts = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/broadcasts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminBroadcasts(response.data.broadcasts);
    } catch (error) {
      console.error('Admin broadcasts fetch error:', error);
    }
  };

  const handleSendBalance = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(`${BACKEND_URL}/api/admin/workspace/send-balance`, sendBalanceForm, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setSendBalanceForm({ user_id: '', amount: '', reason: '' });
      fetchAdminUsers();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to send balance', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const taskData = {
        ...createTaskForm,
        reward: parseFloat(createTaskForm.reward),
        expires_at: createTaskForm.expires_at ? new Date(createTaskForm.expires_at).toISOString() : null
      };
      const response = await axios.post(`${BACKEND_URL}/api/admin/workspace/create-task`, taskData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setCreateTaskForm({ 
        title: '', 
        description: '', 
        reward: '', 
        type: 'one_time', 
        requirements: '', 
        expires_at: '',
        verification_type: 'manual',
        external_url: ''
      });
      fetchAdminTasks();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to create task', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBroadcast = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(`${BACKEND_URL}/api/admin/workspace/broadcast`, broadcastForm, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setBroadcastForm({ title: '', message: '', type: 'info', priority: 'medium' });
      fetchAdminBroadcasts();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to send broadcast', 'error');
    } finally {
      setLoading(false);
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

  useEffect(() => {
    if (activeTab === 'board' && !leaderboardData) {
      fetchLeaderboard();
    }
    if (activeTab === 'workspace' && currentUser?.is_admin) {
      if (adminSubTab === 'dashboard' && !adminDashboard) {
        fetchAdminDashboard();
      } else if (adminSubTab === 'users' && adminUsers.length === 0) {
        fetchAdminUsers();
      } else if (adminSubTab === 'tasks' && adminTasks.length === 0) {
        fetchAdminTasks();
      } else if (adminSubTab === 'broadcasts' && adminBroadcasts.length === 0) {
        fetchAdminBroadcasts();
      }
    }
  }, [activeTab, adminSubTab]);

  const formatCurrency = (amount, currency = null) => {
    const userCurrency = currency || currentUser?.preferred_currency || 'USD';
    const currencyInfo = supportedCurrencies[userCurrency] || { symbol: '$' };
    
    if (amount === Infinity) return `∞ ${userCurrency}`;
    return `${currencyInfo.symbol}${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount || 0)}`;
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

  const copyReferralLink = () => {
    const referralLink = `${window.location.origin}?ref=${currentUser.referral_code}`;
    navigator.clipboard.writeText(referralLink);
    showNotification('Referral link copied to clipboard! 📋', 'success');
  };

  const showNotification = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const completeOnboarding = () => {
    localStorage.setItem('onboarding_completed', 'true');
    setShowOnboarding(false);
    showNotification('Welcome to ProfitPilot! Start earning now! 🚀', 'success');
  };

  // Onboarding Modal
  const OnboardingModal = () => {
    const steps = [
      {
        title: "Welcome to ProfitPilot! 🚀",
        content: "Your journey to passive crypto earnings starts here. Let's show you around!",
        icon: "🎉"
      },
      {
        title: "Auto Mining System ⛏️",
        content: "Every 2 hours, your tokens automatically generate earnings. No manual work required!",
        icon: "⚡"
      },
      {
        title: "Your First Token 🪙",
        content: "You already have 1 free token earning $0.70 every 2 hours. You can own up to 5 tokens total.",
        icon: "🎁"
      },
      {
        title: "Boost for More Earnings 📈",
        content: "Boost tokens to double earnings: Level 1 = $1.40, Level 2 = $2.80, and so on!",
        icon: "🚀"
      },
      {
        title: "Multi-Currency Support 💱",
        content: "Change your preferred currency in settings. All amounts will be converted automatically!",
        icon: "🌍"
      },
      {
        title: "Dark Mode & Themes 🌙",
        content: "Toggle between light and dark themes in your profile settings for comfort!",
        icon: "🎨"
      }
    ];

    const currentStep = steps[onboardingStep];

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-8 text-center">
          <div className="text-6xl mb-4">{currentStep.icon}</div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">{currentStep.title}</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-8">{currentStep.content}</p>
          
          <div className="flex justify-center space-x-2 mb-6">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`w-2 h-2 rounded-full ${index === onboardingStep ? 'bg-blue-600' : 'bg-gray-300'}`}
              />
            ))}
          </div>

          <div className="flex space-x-4">
            {onboardingStep > 0 && (
              <button
                onClick={() => setOnboardingStep(onboardingStep - 1)}
                className="flex-1 py-3 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (onboardingStep < steps.length - 1) {
                  setOnboardingStep(onboardingStep + 1);
                } else {
                  completeOnboarding();
                }
              }}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium"
            >
              {onboardingStep < steps.length - 1 ? 'Next' : 'Start Mining!'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Notification Component
  const NotificationContainer = () => (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`p-4 rounded-lg shadow-lg text-white max-w-sm ${
            notification.type === 'success' ? 'bg-green-500' :
            notification.type === 'error' ? 'bg-red-500' :
            notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
          }`}
        >
          {notification.message}
        </div>
      ))}
    </div>
  );

  // Mobile Menu Component (Enhanced Hamburger Menu)
  const MobileMenu = () => (
    <div className={`fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden ${showMobileMenu ? 'block' : 'hidden'}`}>
      <div className="fixed inset-y-0 left-0 w-80 bg-white dark:bg-gray-800 shadow-lg">
        <div className="p-6 border-b dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center">
                <span className="text-white text-lg font-bold">P</span>
              </div>
              <span className="ml-3 text-xl font-bold text-gray-800 dark:text-white">ProfitPilot</span>
            </div>
            <button 
              onClick={() => setShowMobileMenu(false)} 
              className="text-gray-500 dark:text-gray-400 text-xl"
            >
              ✕
            </button>
          </div>
          
          {/* User Info */}
          <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <p className="text-sm font-medium text-gray-800 dark:text-white">{currentUser?.user_id}</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">{formatCurrency(currentUser?.total_earnings_converted || 0)}</p>
          </div>
        </div>
        
        <nav className="p-4 space-y-2 max-h-96 overflow-y-auto">
          {[
            { id: 'home', icon: '🏠', label: 'Dashboard', desc: 'Overview & stats' },
            ...(currentUser?.is_admin ? [
              { id: 'workspace', icon: '💼', label: 'Workspace', desc: 'Admin controls' }
            ] : [
              { id: 'tokens', icon: '🪙', label: 'My Tokens', desc: 'Manage mining assets' },
              { id: 'boost', icon: '⚡', label: 'Boost Center', desc: 'Upgrade tokens' },
              { id: 'tasks', icon: '🎯', label: 'Tasks', desc: 'Complete & earn' },
              { id: 'notifications', icon: '🔔', label: 'Notifications', desc: `${unreadCount} unread` }
            ]),
            { id: 'referrals', icon: '🤝', label: 'Referrals', desc: 'Invite friends' },
            { id: 'profile', icon: '👤', label: 'Profile', desc: 'Account settings' },
            { id: 'board', icon: '🏆', label: 'Leaderboard', desc: 'Top performers' },
            { id: 'help', icon: '❓', label: 'Help Center', desc: 'Learn & support' }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setShowMobileMenu(false);
              }}
              className={`w-full text-left p-4 rounded-xl transition-colors ${
                activeTab === item.id 
                  ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-400' 
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-xl">{item.icon}</span>
                <div>
                  <div className="font-medium">{item.label}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{item.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </nav>
        
        {/* Theme Toggle */}
        <div className="p-4 border-t dark:border-gray-700">
          <button
            onClick={() => {
              const newTheme = theme === 'light' ? 'dark' : 'light';
              setTheme(newTheme);
              setProfileForm(prev => ({ ...prev, theme: newTheme }));
              handleProfileUpdate({ preventDefault: () => {} });
            }}
            className="flex items-center space-x-3 w-full p-3 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            <span className="text-xl">{theme === 'light' ? '🌙' : '☀️'}</span>
            <span>Switch to {theme === 'light' ? 'Dark' : 'Light'} Mode</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (showAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-8">
          <div className="text-center mb-8">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl font-bold">P</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white">ProfitPilot</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">Professional crypto earnings platform</p>
            
            <div className="mt-6 space-y-3 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex items-center justify-center space-x-2">
                <span>⛏️</span>
                <span>Automated mining every 2 hours</span>
              </div>
              <div className="flex items-center justify-center space-x-2">
                <span>💱</span>
                <span>Multi-currency support</span>
              </div>
              <div className="flex items-center justify-center space-x-2">
                <span>🌙</span>
                <span>Dark/Light theme options</span>
              </div>
              <div className="flex items-center justify-center space-x-2">
                <span>🚀</span>
                <span>Professional admin workspace</span>
              </div>
            </div>
          </div>

          <div className="flex mb-6">
            <button
              className={`flex-1 py-3 px-4 rounded-l-lg font-medium transition-colors ${authMode === 'login' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              className={`flex-1 py-3 px-4 rounded-r-lg font-medium transition-colors ${authMode === 'register' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
              onClick={() => setAuthMode('register')}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                className="w-full p-4 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                required
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Password"
                value={authForm.password}
                onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                className="w-full p-4 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                required
              />
            </div>
            {authMode === 'register' && (
              <div>
                <input
                  type="text"
                  placeholder="Referral Code (Optional)"
                  value={authForm.referralCode}
                  onChange={(e) => setAuthForm({...authForm, referralCode: e.target.value})}
                  className="w-full p-4 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Enter a friend's referral code to earn $2 bonus!</p>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 text-base"
            >
              {loading ? 'Processing...' : (authMode === 'login' ? 'Login' : 'Register & Start Mining')}
            </button>
          </form>

          {authMode === 'register' && (
            <div className="mt-6 p-4 bg-green-50 dark:bg-green-900 rounded-lg">
              <p className="text-sm text-green-700 dark:text-green-300 text-center">
                🎁 <strong>Free Token:</strong> Get your first mining token absolutely free when you register!
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300`}>
      {showOnboarding && <OnboardingModal />}
      <NotificationContainer />
      <MobileMenu />

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <button 
                onClick={() => setShowMobileMenu(true)}
                className="lg:hidden p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                ☰
              </button>
              
              <div className="flex items-center ml-2 lg:ml-0">
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center">
                  <span className="text-white text-lg font-bold">P</span>
                </div>
                <span className="ml-3 text-xl font-bold text-gray-800 dark:text-white">ProfitPilot</span>
                <span className="ml-2 text-xs bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300 px-2 py-1 rounded-full font-medium">LIVE</span>
                {currentUser?.is_admin && (
                  <span className="ml-2 text-xs bg-purple-100 dark:bg-purple-800 text-purple-600 dark:text-purple-300 px-2 py-1 rounded-full font-medium">ADMIN</span>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-4">
              {!currentUser?.is_admin && miningCountdown && (
                <div className="hidden sm:flex items-center space-x-2 bg-orange-50 dark:bg-orange-900 rounded-lg px-3 py-1">
                  <span className="text-sm text-orange-600 dark:text-orange-300">Next:</span>
                  <span className="text-sm font-bold text-orange-600 dark:text-orange-300">{miningCountdown}</span>
                </div>
              )}

              {!currentUser?.is_admin && unreadCount > 0 && (
                <button
                  onClick={() => setActiveTab('notifications')}
                  className="relative bg-blue-50 dark:bg-blue-900 hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-600 dark:text-blue-400 text-sm px-3 py-2 rounded-lg font-medium transition-colors"
                >
                  🔔
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount}
                  </span>
                </button>
              )}

              <div className="hidden md:flex items-center space-x-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-1">
                <span className="text-sm text-gray-600 dark:text-gray-400">Balance:</span>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(currentUser?.total_earnings_converted || currentUser?.total_earnings || 0)}
                </span>
              </div>
              
              {!currentUser?.is_admin && (
                <div className="hidden sm:flex items-center space-x-2 bg-blue-50 dark:bg-blue-900 rounded-lg px-3 py-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Tokens:</span>
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{currentUser?.tokens_owned || 0}/5</span>
                </div>
              )}

              {/* Theme Toggle Button */}
              <button
                onClick={() => {
                  const newTheme = theme === 'light' ? 'dark' : 'light';
                  setTheme(newTheme);
                  setProfileForm(prev => ({ ...prev, theme: newTheme }));
                  handleProfileUpdate({ preventDefault: () => {} });
                }}
                className="hidden lg:flex items-center space-x-1 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400 text-sm px-3 py-2 rounded-lg font-medium transition-colors"
              >
                <span>{theme === 'light' ? '🌙' : '☀️'}</span>
              </button>

              <div className="hidden lg:block text-right">
                <div className="text-sm font-medium text-gray-800 dark:text-white">{currentUser?.user_id}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{currentUser?.email}</div>
              </div>

              <button
                onClick={handleLogout}
                className="bg-red-50 dark:bg-red-900 hover:bg-red-100 dark:hover:bg-red-800 text-red-600 dark:text-red-400 text-sm px-3 py-2 rounded-lg font-medium transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Desktop Navigation - Enhanced */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 hidden lg:block">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {[
              { id: 'home', icon: '🏠', label: 'Dashboard' },
              ...(currentUser?.is_admin ? [
                { id: 'workspace', icon: '💼', label: 'Workspace' }
              ] : [
                { id: 'tokens', icon: '🪙', label: 'My Tokens' },
                { id: 'boost', icon: '⚡', label: 'Boost Center' },
                { id: 'tasks', icon: '🎯', label: 'Tasks' },
                { id: 'notifications', icon: '🔔', label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}` }
              ]),
              { id: 'referrals', icon: '🤝', label: 'Referrals' },
              { id: 'profile', icon: '👤', label: 'Profile' },
              { id: 'board', icon: '🏆', label: 'Leaderboard' },
              { id: 'help', icon: '❓', label: 'Help' }
            ].map(tab => (
              <button
                key={tab.id}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id 
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'home' && dashboardData && (
          <div className="space-y-6">
            {/* Welcome Header - Enhanced */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl text-white p-6 sm:p-8">
              <div className="flex flex-col lg:flex-row justify-between items-start">
                <div className="w-full lg:w-auto">
                  <h1 className="text-2xl sm:text-3xl font-bold mb-2">
                    Welcome Back{currentUser?.is_admin ? ', Admin' : ''}! 👋
                  </h1>
                  <p className="text-blue-100 mb-6">
                    {currentUser?.is_admin ? 'Professional system oversight and management' : `Here's your portfolio in ${currentUser?.preferred_currency || 'USD'}`}
                  </p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 lg:gap-8">
                    <div>
                      <p className="text-blue-200 text-sm mb-1">
                        {currentUser?.is_admin ? 'Platform Status' : 'Total Balance'}
                      </p>
                      <p className="text-2xl sm:text-4xl font-bold">
                        {currentUser?.is_admin ? 'OPERATIONAL' : formatCurrency(dashboardData.stats.total_balance_converted || dashboardData.stats.total_balance)}
                      </p>
                    </div>
                    <div>
                      <p className="text-blue-200 text-sm mb-1">
                        {currentUser?.is_admin ? 'Mining System' : 'Active Assets'}
                      </p>
                      <p className="text-2xl sm:text-4xl font-bold">
                        {currentUser?.is_admin ? 'AUTOMATED' : dashboardData.stats.active_assets}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 lg:mt-0 text-right">
                  <div className="bg-white bg-opacity-20 rounded-lg p-3">
                    <span className="text-2xl">{currentUser?.is_admin ? '⚙️' : '✨'}</span>
                  </div>
                </div>
              </div>

              {!currentUser?.is_admin && miningCountdown && (
                <div className="mt-6 sm:hidden bg-white bg-opacity-20 rounded-lg p-3 text-center">
                  <p className="text-blue-100 text-sm">Next Mining</p>
                  <p className="text-lg font-bold">{miningCountdown}</p>
                </div>
              )}

              <div className="mt-4 flex items-center justify-center sm:justify-start space-x-2 text-blue-100 text-sm">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span>Professional automated system</span>
              </div>
            </div>

            {!currentUser?.is_admin && (
              <>
                <div className="grid grid-cols-2 gap-4 sm:hidden">
                  <button
                    onClick={() => setActiveTab('tokens')}
                    className="bg-white dark:bg-gray-800 rounded-xl p-4 text-center shadow-sm border dark:border-gray-700"
                  >
                    <div className="text-2xl mb-2">🪙</div>
                    <div className="text-sm font-medium text-gray-800 dark:text-white">My Tokens</div>
                  </button>
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className="bg-white dark:bg-gray-800 rounded-xl p-4 text-center shadow-sm border dark:border-gray-700 relative"
                  >
                    <div className="text-2xl mb-2">🎯</div>
                    <div className="text-sm font-medium text-gray-800 dark:text-white">Tasks</div>
                    {userTasks.length > 0 && (
                      <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        {userTasks.length}
                      </span>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                  <div className="bg-green-50 dark:bg-green-900 rounded-xl p-4 lg:p-6">
                    <div className="flex items-center justify-between mb-2 lg:mb-4">
                      <div className="bg-green-500 rounded-lg p-2">
                        <span className="text-white text-sm lg:text-lg">💰</span>
                      </div>
                      <span className="text-green-600 dark:text-green-400 text-xs font-medium hidden lg:block">Converted</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-xs lg:text-sm mb-1">Total Earnings</p>
                    <p className="text-lg lg:text-2xl font-bold text-gray-800 dark:text-white">
                      {formatCurrency(currentUser.total_earnings_converted || currentUser.total_earnings)}
                    </p>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-900 rounded-xl p-4 lg:p-6">
                    <div className="flex items-center justify-between mb-2 lg:mb-4">
                      <div className="bg-blue-500 rounded-lg p-2">
                        <span className="text-white text-sm lg:text-lg">🔗</span>
                      </div>
                      <span className="text-blue-600 dark:text-blue-400 text-xs font-medium">{currentUser.tokens_owned}/5</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-xs lg:text-sm mb-1">Active Tokens</p>
                    <p className="text-lg lg:text-2xl font-bold text-gray-800 dark:text-white">{currentUser.tokens_owned}</p>
                  </div>

                  <div className="bg-purple-50 dark:bg-purple-900 rounded-xl p-4 lg:p-6">
                    <div className="flex items-center justify-between mb-2 lg:mb-4">
                      <div className="bg-purple-500 rounded-lg p-2">
                        <span className="text-white text-sm lg:text-lg">👥</span>
                      </div>
                      <span className="text-purple-600 dark:text-purple-400 text-xs font-medium hidden lg:block">
                        {formatCurrency(currentUser.referral_earnings_converted || currentUser.referral_earnings)} earned
                      </span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-xs lg:text-sm mb-1">Referrals</p>
                    <p className="text-lg lg:text-2xl font-bold text-gray-800 dark:text-white">{currentUser.referrals_count}</p>
                  </div>

                  <div className="bg-orange-50 dark:bg-orange-900 rounded-xl p-4 lg:p-6">
                    <div className="flex items-center justify-between mb-2 lg:mb-4">
                      <div className="bg-orange-500 rounded-lg p-2">
                        <span className="text-white text-sm lg:text-lg">⚡</span>
                      </div>
                      <span className="text-orange-600 dark:text-orange-400 text-xs font-medium">Total</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-xs lg:text-sm mb-1">Boosts Used</p>
                    <p className="text-lg lg:text-2xl font-bold text-gray-800 dark:text-white">{currentUser.boosts_used}</p>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">🤝 Referral Program</h3>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Your referral code:</p>
                    <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
                      <code className="bg-gray-200 dark:bg-gray-600 dark:text-white px-3 py-2 rounded text-sm font-mono flex-1">{currentUser.referral_code}</code>
                      <button
                        onClick={copyReferralLink}
                        className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors"
                      >
                        Copy Link
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Earn $2 for each person who joins with your code!</p>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">💸 Withdrawal Status</h3>
                  <div className="bg-yellow-50 dark:bg-yellow-900 rounded-lg p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                      <div className="mb-2 sm:mb-0">
                        <p className="font-medium text-gray-800 dark:text-white">Time until withdrawal eligible:</p>
                        <p className="text-xl lg:text-2xl font-bold text-yellow-600 dark:text-yellow-400">{formatTimeUntilWithdrawal(currentUser.withdrawal_eligible_at)}</p>
                      </div>
                      <div className="text-yellow-500 text-2xl lg:text-3xl text-right">⏰</div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Professional Admin Workspace */}
        {activeTab === 'workspace' && currentUser?.is_admin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 sm:mb-0">💼 Admin Workspace</h2>
              <p className="text-gray-600 dark:text-gray-400">Professional system management</p>
            </div>

            {/* Admin Sub-Navigation */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm">
              <div className="flex flex-wrap border-b dark:border-gray-700">
                {[
                  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
                  { id: 'users', label: 'User Management', icon: '👥' },
                  { id: 'tasks', label: 'Task Manager', icon: '🎯' },
                  { id: 'broadcasts', label: 'Broadcasting', icon: '📢' },
                  { id: 'system', label: 'System Status', icon: '⚙️' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setAdminSubTab(tab.id)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                      adminSubTab === tab.id
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-6">
                {adminSubTab === 'dashboard' && adminDashboard && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-green-50 dark:bg-green-900 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          ${adminDashboard.revenue_metrics.total_revenue.toFixed(2)}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Total Revenue</div>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{adminDashboard.user_metrics.total_users}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Total Users</div>
                      </div>
                      <div className="bg-purple-50 dark:bg-purple-900 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{adminDashboard.user_metrics.users_online}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Users Online</div>
                      </div>
                      <div className="bg-orange-50 dark:bg-orange-900 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{adminDashboard.token_metrics.tokens_bought}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Tokens Bought</div>
                      </div>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-6">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
                        <h3 className="font-semibold text-gray-800 dark:text-white mb-4">Token Metrics</h3>
                        <div className="space-y-3">
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Total Tokens:</span>
                            <span className="font-medium text-gray-800 dark:text-white">{adminDashboard.token_metrics.total_tokens}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Active Tokens:</span>
                            <span className="font-medium text-gray-800 dark:text-white">{adminDashboard.token_metrics.active_tokens}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Boost Purchases:</span>
                            <span className="font-medium text-gray-800 dark:text-white">{adminDashboard.token_metrics.boost_purchases}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
                        <h3 className="font-semibold text-gray-800 dark:text-white mb-4">Platform Activity</h3>
                        <div className="space-y-3">
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Total Transactions:</span>
                            <span className="font-medium text-gray-800 dark:text-white">{adminDashboard.platform_activity.total_transactions}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Total Tasks:</span>
                            <span className="font-medium text-gray-800 dark:text-white">{adminDashboard.platform_activity.total_tasks}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Task Completions:</span>
                            <span className="font-medium text-gray-800 dark:text-white">{adminDashboard.platform_activity.total_task_completions}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-6">
                      <h3 className="font-semibold text-gray-800 dark:text-white mb-4">🔄 Automated Mining Status</h3>
                      <div className="grid lg:grid-cols-3 gap-4">
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">ACTIVE</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Mining System</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-green-600 dark:text-green-400">{adminDashboard.mining_status.tokens_processed_today}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Tokens Processed Today</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-green-600 dark:text-green-400">
                            ${adminDashboard.mining_status.earnings_distributed_today.toFixed(2)}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Earnings Distributed Today</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {adminSubTab === 'users' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">User Management</h3>
                      <button
                        onClick={fetchAdminUsers}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Refresh Users
                      </button>
                    </div>

                    {/* Send Balance Form */}
                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
                      <h4 className="font-medium text-gray-800 dark:text-white mb-4">💰 Send Balance to User</h4>
                      <form onSubmit={handleSendBalance} className="space-y-4">
                        <div className="grid lg:grid-cols-3 gap-4">
                          <input
                            type="text"
                            placeholder="User ID"
                            value={sendBalanceForm.user_id}
                            onChange={(e) => setSendBalanceForm({...sendBalanceForm, user_id: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                            required
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Amount ($)"
                            value={sendBalanceForm.amount}
                            onChange={(e) => setSendBalanceForm({...sendBalanceForm, amount: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                            required
                          />
                          <input
                            type="text"
                            placeholder="Reason"
                            value={sendBalanceForm.reason}
                            onChange={(e) => setSendBalanceForm({...sendBalanceForm, reason: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                            required
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={loading}
                          className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {loading ? 'Sending...' : 'Send Balance'}
                        </button>
                      </form>
                    </div>

                    <div className="grid gap-4">
                      {adminUsers.map((user) => (
                        <div key={user.user_id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                            <div className="mb-4 sm:mb-0">
                              <div className="flex items-center space-x-2">
                                <h4 className="font-semibold text-gray-800 dark:text-white">{user.user_id}</h4>
                                <span className={`px-2 py-1 rounded-full text-xs ${
                                  user.online_status === 'online' 
                                    ? 'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200' 
                                    : 'bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-200'
                                }`}>
                                  {user.online_status}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{user.email}</p>
                              <p className="text-sm text-gray-500 dark:text-gray-500">
                                Joined: {new Date(user.created_at).toLocaleDateString()}
                              </p>
                              <div className="flex space-x-4 mt-2 text-sm">
                                <span className="text-gray-600 dark:text-gray-400">Balance: {formatCurrency(user.total_earnings)}</span>
                                <span className="text-gray-600 dark:text-gray-400">Tokens: {user.tokens_owned}</span>
                                <span className="text-gray-600 dark:text-gray-400">Referrals: {user.referrals_count}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => fetchUserDetails(user.user_id)}
                              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors"
                            >
                              View Details
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedUser && (
                      <div className="bg-white dark:bg-gray-800 border-2 border-blue-200 dark:border-blue-700 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
                          User Details: {selectedUser.user.user_id}
                        </h3>
                        
                        <div className="grid lg:grid-cols-2 gap-6">
                          <div>
                            <h4 className="font-medium text-gray-800 dark:text-white mb-2">Basic Info</h4>
                            <div className="space-y-2 text-sm">
                              <p className="text-gray-600 dark:text-gray-400"><strong>Email:</strong> {selectedUser.user.email}</p>
                              <p className="text-gray-600 dark:text-gray-400"><strong>Balance:</strong> {formatCurrency(selectedUser.user.total_earnings)}</p>
                              <p className="text-gray-600 dark:text-gray-400"><strong>Tokens:</strong> {selectedUser.user.tokens_owned}</p>
                              <p className="text-gray-600 dark:text-gray-400"><strong>Referrals:</strong> {selectedUser.user.referrals_count}</p>
                                <p className="text-gray-600 dark:text-gray-400"><strong>Currency:</strong> {selectedUser.user.preferred_currency}</p>
                              <p className="text-gray-600 dark:text-gray-400"><strong>Theme:</strong> {selectedUser.user.theme}</p>
                            </div>
                          </div>
                          
                          <div>
                            <h4 className="font-medium text-gray-800 dark:text-white mb-2">User Tokens</h4>
                            <div className="space-y-2">
                              {selectedUser.tokens.map((token) => (
                                <div key={token.token_id} className="text-sm bg-gray-100 dark:bg-gray-600 p-2 rounded">
                                  <p className="text-gray-800 dark:text-white"><strong>{token.name}</strong> - Level {token.boost_level}</p>
                                  <p className="text-gray-600 dark:text-gray-400">Earned: {formatCurrency(token.total_earnings)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => setSelectedUser(null)}
                          className="mt-4 bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors"
                        >
                          Close Details
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {adminSubTab === 'tasks' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Task Manager</h3>
                      <button
                        onClick={fetchAdminTasks}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Refresh Tasks
                      </button>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
                      <h4 className="font-medium text-gray-800 dark:text-white mb-4">🎯 Create New Task</h4>
                      <form onSubmit={handleCreateTask} className="space-y-4">
                        <div className="grid lg:grid-cols-2 gap-4">
                          <input
                            type="text"
                            placeholder="Task Title"
                            value={createTaskForm.title}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, title: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                            required
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Reward Amount ($)"
                            value={createTaskForm.reward}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, reward: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                            required
                          />
                        </div>
                        <textarea
                          placeholder="Task Description"
                          value={createTaskForm.description}
                          onChange={(e) => setCreateTaskForm({...createTaskForm, description: e.target.value})}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg h-24"
                          required
                        />
                        <div className="grid lg:grid-cols-4 gap-4">
                          <select
                            value={createTaskForm.type}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, type: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                          >
                            <option value="one_time">One Time</option>
                            <option value="daily">Daily</option>
                            <option value="repeatable">Repeatable</option>
                          </select>
                          <select
                            value={createTaskForm.verification_type}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, verification_type: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                          >
                            <option value="manual">Manual</option>
                            <option value="automatic">Automatic</option>
                            <option value="external">External</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Requirements (optional)"
                            value={createTaskForm.requirements}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, requirements: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                          />
                          <input
                            type="datetime-local"
                            placeholder="Expires At (optional)"
                            value={createTaskForm.expires_at}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, expires_at: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                          />
                        </div>
                        {createTaskForm.verification_type === 'external' && (
                          <input
                            type="url"
                            placeholder="External URL (for external verification)"
                            value={createTaskForm.external_url}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, external_url: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                          />
                        )}
                        <button
                          type="submit"
                          disabled={loading}
                          className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {loading ? 'Creating...' : 'Create Task'}
                        </button>
                      </form>
                    </div>

                    <div className="grid gap-4">
                      {adminTasks.map((task) => (
                        <div key={task.task_id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-semibold text-gray-800 dark:text-white">{task.title}</h4>
                              <p className="text-gray-600 dark:text-gray-400 text-sm">{task.description}</p>
                              <div className="flex space-x-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                                <span>Reward: {formatCurrency(task.reward)}</span>
                                <span>Type: {task.type}</span>
                                <span>Verification: {task.verification_type}</span>
                                <span>Completed: {task.completion_count} times</span>
                              </div>
                              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                <span>Total Rewards Paid: {formatCurrency(task.total_rewards_paid)}</span>
                              </div>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs ${
                              task.active ? 'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200'
                            }`}>
                              {task.active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adminSubTab === 'broadcasts' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Broadcasting Center</h3>
                      <button
                        onClick={fetchAdminBroadcasts}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Refresh Broadcasts
                      </button>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
                      <h4 className="font-medium text-gray-800 dark:text-white mb-4">📢 Send Broadcast Message</h4>
                      <form onSubmit={handleBroadcast} className="space-y-4">
                        <div className="grid lg:grid-cols-2 gap-4">
                          <input
                            type="text"
                            placeholder="Broadcast Title"
                            value={broadcastForm.title}
                            onChange={(e) => setBroadcastForm({...broadcastForm, title: e.target.value})}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                            required
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={broadcastForm.type}
                              onChange={(e) => setBroadcastForm({...broadcastForm, type: e.target.value})}
                              className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                            >
                              <option value="info">Info</option>
                              <option value="success">Success</option>
                              <option value="warning">Warning</option>
                              <option value="error">Error</option>
                            </select>
                            <select
                              value={broadcastForm.priority}
                              onChange={(e) => setBroadcastForm({...broadcastForm, priority: e.target.value})}
                              className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg"
                            >
                              <option value="low">Low Priority</option>
                              <option value="medium">Medium Priority</option>
                              <option value="high">High Priority</option>
                            </select>
                          </div>
                        </div>
                        <textarea
                          placeholder="Broadcast Message"
                          value={broadcastForm.message}
                          onChange={(e) => setBroadcastForm({...broadcastForm, message: e.target.value})}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg h-24"
                          required
                        />
                        <button
                          type="submit"
                          disabled={loading}
                          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {loading ? 'Sending...' : 'Send Broadcast'}
                        </button>
                      </form>
                    </div>

                    <div className="grid gap-4">
                      {adminBroadcasts.map((broadcast) => (
                        <div key={broadcast.broadcast_id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-semibold text-gray-800 dark:text-white">{broadcast.title}</h4>
                              <p className="text-gray-600 dark:text-gray-400 text-sm">{broadcast.message}</p>
                              <div className="flex space-x-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                                <span>Recipients: {broadcast.recipient_count}</span>
                                <span>Priority: {broadcast.priority}</span>
                                <span>Sent: {new Date(broadcast.created_at).toLocaleString()}</span>
                              </div>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs ${
                              broadcast.type === 'success' ? 'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200' :
                              broadcast.type === 'error' ? 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200' :
                              broadcast.type === 'warning' ? 'bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200' :
                              'bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200'
                            }`}>
                              {broadcast.type}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adminSubTab === 'system' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-white">⚙️ System Status</h3>
                    
                    <div className="grid lg:grid-cols-3 gap-6">
                      <div className="bg-green-50 dark:bg-green-900 rounded-lg p-6 text-center">
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">HEALTHY</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Database Status</div>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-6 text-center">
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">AUTOMATED</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Mining System</div>
                      </div>
                      <div className="bg-purple-50 dark:bg-purple-900 rounded-lg p-6 text-center">
                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">OPTIMIZED</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Performance</div>
                      </div>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-6">
                      <h4 className="font-semibold text-gray-800 dark:text-white mb-4">🔄 Mining System Status</h4>
                      <div className="grid lg:grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">System Status:</p>
                          <p className="text-lg font-bold text-green-600 dark:text-green-400">FULLY AUTOMATED</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Intervention Required:</p>
                          <p className="text-lg font-bold text-blue-600 dark:text-blue-400">NONE</p>
                        </div>
                      </div>
                      <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          ✅ Mining runs automatically every 2 hours<br />
                          ✅ No manual triggers required<br />
                          ✅ Professional system monitoring active<br />
                          ✅ Error recovery mechanisms in place
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tasks Tab */}
        {activeTab === 'tasks' && !currentUser?.is_admin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 sm:mb-0">🎯 Available Tasks</h2>
              <p className="text-gray-600 dark:text-gray-400">Complete tasks to earn extra rewards</p>
            </div>

            {userTasks.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8 text-center">
                <div className="text-4xl mb-4">🎯</div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">No Tasks Available</h3>
                <p className="text-gray-600 dark:text-gray-400">Check back later for new earning opportunities!</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {userTasks.map((task) => (
                  <div key={task.task_id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-4">
                      <div className="mb-4 sm:mb-0">
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">{task.title}</h3>
                        <p className="text-gray-600 dark:text-gray-400 mb-2">{task.description}</p>
                        {task.requirements && (
                          <p className="text-sm text-blue-600 dark:text-blue-400">Requirements: {task.requirements}</p>
                        )}
                        <div className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                          <span>Type: {task.type === 'daily' ? 'Daily Task' : 
                                       task.type === 'repeatable' ? 'Repeatable' : 'One Time'}</span>
                          {task.verification_type && (
                            <span className="ml-4">Verification: {task.verification_type}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200 px-3 py-1 rounded-full text-sm font-medium mb-2">
                          +{formatCurrency(task.reward)}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                      <div className="text-sm text-gray-500 dark:text-gray-500 mb-2 sm:mb-0">
                        {task.expires_at && `Expires: ${new Date(task.expires_at).toLocaleDateString()}`}
                      </div>
                      <button
                        onClick={() => completeTask(task.task_id)}
                        className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                      >
                        Complete Task
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && !currentUser?.is_admin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 sm:mb-0">🔔 Notifications</h2>
              <p className="text-gray-600 dark:text-gray-400">{unreadCount} unread messages</p>
            </div>

            {userNotifications.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8 text-center">
                <div className="text-4xl mb-4">🔔</div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">No Notifications</h3>
                <p className="text-gray-600 dark:text-gray-400">You're all caught up!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {userNotifications.map((notification) => (
                  <div 
                    key={notification.notification_id} 
                    className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 cursor-pointer transition-colors ${
                      !notification.read ? 'border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900' : ''
                    }`}
                    onClick={() => !notification.read && markNotificationRead(notification.notification_id)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800 dark:text-white mb-1">{notification.title}</h3>
                        <p className="text-gray-600 dark:text-gray-400 text-sm mb-2">{notification.message}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                          {new Date(notification.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="ml-4">
                        <span className={`inline-block w-3 h-3 rounded-full ${
                          notification.type === 'success' ? 'bg-green-500' :
                          notification.type === 'error' ? 'bg-red-500' :
                          notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}></span>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full mt-1 ml-0.5"></div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tokens and Boost Tabs */}
        {(activeTab === 'tokens' || activeTab === 'boost') && dashboardData && !currentUser?.is_admin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 sm:mb-0">
                {activeTab === 'tokens' ? '🪙 Your Tokens' : '⚡ Boost Center'}
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                {activeTab === 'tokens' ? 'Manage your mining tokens' : 'Upgrade tokens for higher earnings'}
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900 rounded-xl p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">
                {activeTab === 'tokens' ? '⛏️ How Mining Works' : '🚀 How Boosting Works'}
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                {activeTab === 'tokens' 
                  ? 'Your tokens automatically mine every 2 hours. Base earning is $0.70 per token per cycle.'
                  : 'Boosting doubles your earnings per level. Level 1 = $1.40, Level 2 = $2.80, Level 3 = $5.60, etc.'
                }
              </p>
              
              {activeTab === 'boost' && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800 dark:text-white">Level 0</div>
                    <div className="text-lg font-bold text-green-600 dark:text-green-400">$0.70</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800 dark:text-white">Level 1</div>
                    <div className="text-lg font-bold text-green-600 dark:text-green-400">$1.40</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800 dark:text-white">Level 2</div>
                    <div className="text-lg font-bold text-green-600 dark:text-green-400">$2.80</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800 dark:text-white">Level 3</div>
                    <div className="text-lg font-bold text-green-600 dark:text-green-400">$5.60</div>
                  </div>
                </div>
              )}
            </div>

            {currentUser.tokens_owned < 5 && activeTab === 'tokens' && (
              <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900 dark:to-blue-900 rounded-xl p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">➕ Add More Tokens</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">Expand your mining capacity with additional tokens ($5 each)</p>
                <button
                  onClick={() => handlePayment('token')}
                  disabled={loading}
                  className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  + Add Token ($5)
                </button>
              </div>
            )}

            <div className="grid gap-4 lg:gap-6">
              {dashboardData.tokens.map((token, index) => (
                <div key={token.token_id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-4">
                    <div className="mb-2 sm:mb-0">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">{token.name}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Created: {new Date(token.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm text-gray-500 dark:text-gray-400">Boost Level</p>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{token.boost_level}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Total Earned</p>
                      <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                        {formatCurrency(token.total_earnings_converted || token.total_earnings)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Per Cycle (2h)</p>
                      <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                        {formatCurrency(0.70 * Math.pow(2, token.boost_level))}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Boost Cost</p>
                      <p className="text-lg font-semibold text-orange-600 dark:text-orange-400">
                        {formatCurrency(3 * Math.pow(2, token.boost_level))}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handlePayment('boost', token.token_id)}
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    ⚡ Boost Token ({formatCurrency(3 * Math.pow(2, token.boost_level))})
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Referrals Tab */}
        {activeTab === 'referrals' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 sm:mb-0">🤝 Referral Program</h2>
              <p className="text-gray-600 dark:text-gray-400">Earn $2 for every friend you invite</p>
            </div>

            <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900 dark:to-pink-900 rounded-xl p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">💰 How It Works</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="bg-white dark:bg-gray-800 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">📤</span>
                  </div>
                  <h4 className="font-medium text-gray-800 dark:text-white">1. Share Your Code</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Send your unique referral code to friends</p>
                </div>
                <div className="text-center">
                  <div className="bg-white dark:bg-gray-800 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">👥</span>
                  </div>
                  <h4 className="font-medium text-gray-800 dark:text-white">2. They Register</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Friend joins using your referral code</p>
                </div>
                <div className="text-center">
                  <div className="bg-white dark:bg-gray-800 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">💰</span>
                  </div>
                  <h4 className="font-medium text-gray-800 dark:text-white">3. Both Earn $2</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">You both get $2 instantly added</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">👥</div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{currentUser?.referrals_count || 0}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Referrals</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">💰</div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(currentUser?.referral_earnings_converted || currentUser?.referral_earnings || 0)}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Earned</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">📈</div>
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {formatCurrency((currentUser?.referrals_count || 0) * 2)}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Potential</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">🎯</div>
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">∞</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Unlimited</div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">📤 Share Your Code</h3>
              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Your referral code:</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <code className="bg-white dark:bg-gray-600 border dark:border-gray-500 px-4 py-3 rounded text-lg font-mono flex-1 text-center dark:text-white">{currentUser?.referral_code}</code>
                    <button
                      onClick={copyReferralLink}
                      className="bg-blue-600 text-white px-6 py-3 rounded font-medium hover:bg-blue-700 transition-colors"
                    >
                      📋 Copy Link
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 sm:mb-0">👤 Profile</h2>
              <p className="text-gray-600 dark:text-gray-400">Manage your account and settings</p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm">
              <div className="flex flex-wrap border-b dark:border-gray-700">
                {[
                  { id: 'account', label: 'Account', icon: '👤' },
                  { id: 'preferences', label: 'Preferences', icon: '⚙️' },
                  { id: 'security', label: 'Security', icon: '🔐' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setProfileSubTab(tab.id)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                      profileSubTab === tab.id
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-4 lg:p-6">
                {profileSubTab === 'account' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Account Information</h3>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">User ID</label>
                        <input
                          type="text"
                          value={currentUser?.user_id || ''}
                          disabled
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
                        <input
                          type="email"
                          value={currentUser?.email || ''}
                          disabled
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Member Since</label>
                        <input
                          type="text"
                          value={currentUser?.created_at ? new Date(currentUser.created_at).toLocaleDateString() : ''}
                          disabled
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Referral Code</label>
                        <input
                          type="text"
                          value={currentUser?.referral_code || ''}
                          disabled
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                    </div>

                    {currentUser?.is_admin && (
                      <div className="bg-purple-50 dark:bg-purple-900 rounded-lg p-4">
                        <h4 className="font-medium text-purple-800 dark:text-purple-200 mb-2">🔧 Admin Privileges</h4>
                        <div className="text-sm text-purple-700 dark:text-purple-300 space-y-1">
                          <p>✓ Professional workspace access</p>
                          <p>✓ User management capabilities</p>
                          <p>✓ Dynamic task creation system</p>
                          <p>✓ Broadcasting and messaging</p>
                          <p>✓ System monitoring and analytics</p>
                          <p>✓ Revenue and performance tracking</p>
                        </div>
                      </div>
                    )}

                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                      <h4 className="font-medium text-gray-800 dark:text-white mb-2">Account Stats</h4>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                            {formatCurrency(currentUser?.total_earnings_converted || currentUser?.total_earnings || 0)}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Total Earnings</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{currentUser?.tokens_owned || 0}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Tokens Owned</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{currentUser?.referrals_count || 0}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Referrals</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{currentUser?.boosts_used || 0}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Boosts Used</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {profileSubTab === 'preferences' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-white">User Preferences</h3>
                    
                    <form onSubmit={handleProfileUpdate} className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          💱 Preferred Currency
                        </label>
                        <select
                          value={profileForm.preferred_currency}
                          onChange={(e) => setProfileForm({...profileForm, preferred_currency: e.target.value})}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                        >
                          {Object.entries(supportedCurrencies).map(([code, info]) => (
                            <option key={code} value={code}>
                              {info.symbol} {code} - {info.name}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          All amounts will be converted to your preferred currency
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          🎨 Theme Preference
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                          <button
                            type="button"
                            onClick={() => setProfileForm({...profileForm, theme: 'light'})}
                            className={`p-4 rounded-lg border-2 transition-colors ${
                              profileForm.theme === 'light'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900'
                                : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                          >
                            <div className="text-2xl mb-2">☀️</div>
                            <div className="text-sm font-medium text-gray-800 dark:text-white">Light Mode</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setProfileForm({...profileForm, theme: 'dark'})}
                            className={`p-4 rounded-lg border-2 transition-colors ${
                              profileForm.theme === 'dark'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900'
                                : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                          >
                            <div className="text-2xl mb-2">🌙</div>
                            <div className="text-sm font-medium text-gray-800 dark:text-white">Dark Mode</div>
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div>
                          <h4 className="font-medium text-gray-800 dark:text-white">🔔 Notifications</h4>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Mining alerts and updates</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setProfileForm({...profileForm, notifications_enabled: !profileForm.notifications_enabled})}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            profileForm.notifications_enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            profileForm.notifications_enabled ? 'translate-x-6' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {loading ? 'Updating...' : 'Save Preferences'}
                      </button>
                    </form>
                  </div>
                )}

                {profileSubTab === 'security' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Security Settings</h3>
                    
                    <div className="bg-yellow-50 dark:bg-yellow-900 rounded-lg p-4">
                      <h4 className="font-medium text-gray-800 dark:text-white mb-2">🔐 Account Security</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Your account is secured with industry-standard encryption and professional security measures.
                        Password management and 2FA features coming soon!
                      </p>
                    </div>

                    <div className="bg-green-50 dark:bg-green-900 rounded-lg p-4">
                      <h4 className="font-medium text-gray-800 dark:text-white mb-2">🛡️ Security Features</h4>
                      <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                        <p>✓ Professional JWT token authentication</p>
                        <p>✓ Secure password hashing with bcrypt</p>
                        <p>✓ Session management and monitoring</p>
                        <p>✓ Automated security logging</p>
                        <p>✓ Professional API security measures</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard Tab */}
        {activeTab === 'board' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">🏆 Leaderboard</h2>
            
            {leaderboardData ? (
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">💰 Top Earners</h3>
                  <div className="space-y-3">
                    {leaderboardData.top_earners.map((user, index) => (
                      <div key={user.user_id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                            index === 0 ? 'bg-yellow-500' : 
                            index === 1 ? 'bg-gray-400' : 
                            index === 2 ? 'bg-orange-600' : 'bg-gray-300'
                          }`}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium text-sm text-gray-800 dark:text-white">{user.user_id}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{user.email}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-green-600 dark:text-green-400 text-sm">{formatCurrency(user.total_earnings)}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{user.tokens_owned} tokens</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">⚡ Most Boosted Tokens</h3>
                  <div className="space-y-3">
                    {leaderboardData.top_tokens.map((token, index) => (
                      <div key={token.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                            index === 0 ? 'bg-yellow-500' : 
                            index === 1 ? 'bg-gray-400' : 
                            index === 2 ? 'bg-orange-600' : 'bg-gray-300'
                          }`}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium text-sm text-gray-800 dark:text-white">{token.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Owner: {token.owner_id}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-blue-600 dark:text-blue-400 text-sm">Level {token.boost_level}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{formatCurrency(token.total_earnings)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-4">🏆</div>
                <p className="text-gray-500 dark:text-gray-400">Loading leaderboard...</p>
              </div>
            )}
          </div>
        )}

        {/* Help Tab */}
        {activeTab === 'help' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 sm:mb-0">❓ Help Center</h2>
              <p className="text-gray-600 dark:text-gray-400">Everything you need to know about ProfitPilot</p>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900 dark:to-purple-900 rounded-xl p-4 lg:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                <div className="mb-4 sm:mb-0">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white">🚀 New to ProfitPilot?</h3>
                  <p className="text-gray-600 dark:text-gray-400">Take our quick tour to learn the basics</p>
                </div>
                <button
                  onClick={() => setShowOnboarding(true)}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
                >
                  Take Tour Again
                </button>
              </div>
            </div>

            <div className="grid gap-6">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">⛏️ Mining System</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-medium text-gray-800 dark:text-white">How does automated mining work?</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Your tokens automatically generate earnings every 2 hours. The system is fully automated and professional - no manual intervention required!</p>
                  </div>
                  <div className="border-l-4 border-green-500 pl-4">
                    <h4 className="font-medium text-gray-800 dark:text-white">Multi-currency support</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">All earnings are automatically converted to your preferred currency. Change your currency in the profile settings anytime!</p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">🎯 Tasks & Features</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-medium text-gray-800 dark:text-white">Dynamic task system</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Complete tasks created by administrators to earn extra rewards. Tasks are dynamically created and automatically verified!</p>
                  </div>
                  <div className="border-l-4 border-orange-500 pl-4">
                    <h4 className="font-medium text-gray-800 dark:text-white">Dark/Light mode</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Switch between light and dark themes for comfortable viewing. Your preference is saved automatically!</p>
                  </div>
                </div>
              </div>

              {currentUser?.is_admin && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">💼 Admin Workspace</h3>
                  <div className="space-y-4">
                    <div className="border-l-4 border-red-500 pl-4">
                      <h4 className="font-medium text-gray-800 dark:text-white">Professional management</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Access comprehensive user management, revenue tracking, and system monitoring tools in your professional workspace.</p>
                    </div>
                    <div className="border-l-4 border-indigo-500 pl-4">
                      <h4 className="font-medium text-gray-800 dark:text-white">Automated systems</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Mining system is fully automated - no manual triggers needed. Monitor system health and performance from your dashboard.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
