import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

// Professional animation helpers
const fadeIn = 'transition-opacity duration-700 ease-out opacity-0 animate-fade-in';
const fadeInUp = 'transition-all duration-700 ease-out opacity-0 translate-y-4 animate-fade-in-up';

// Backend URL
const BACKEND_URL = process.env.REACT_APP_API_URL || 'http://localhost:8001';

// Professional notification system with animation
const NotificationContainer = ({ notifications }) => (
  <div className="fixed top-6 right-6 z-50 space-y-3">
    {notifications.map(notification => (
      <div
        key={notification.id}
        className={`p-4 rounded-lg shadow-2xl text-white max-w-sm flex items-center gap-3
          ${fadeIn}
          ${
            notification.type === 'success' ? 'bg-gradient-to-r from-green-500 to-emerald-600'
            : notification.type === 'error' ? 'bg-gradient-to-r from-red-500 to-pink-500'
            : notification.type === 'warning' ? 'bg-gradient-to-r from-yellow-500 to-yellow-600'
            : 'bg-gradient-to-r from-blue-500 to-purple-500'
          }`}
        style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}
      >
        <span className="text-xl">
          {notification.type === 'success' ? '✅'
            : notification.type === 'error' ? '❌'
            : notification.type === 'warning' ? '⚠️'
            : 'ℹ️'}
        </span>
        <span className="flex-1">{notification.message}</span>
      </div>
    ))}
  </div>
);

// Animation keyframes (inject into <style> if not already present)
if (typeof window !== "undefined") {
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    .animate-fade-in { animation: fade-in 0.7s ease-out forwards; }

    @keyframes fade-in-up { from { opacity: 0; transform: translateY(16px);} to { opacity: 1; transform: translateY(0);} }
    .animate-fade-in-up { animation: fade-in-up 0.7s cubic-bezier(.23,1.03,.57,1.05) forwards;}
  `;
  if (!document.head.querySelector('style[data-pp-anim]')) {
    style.setAttribute('data-pp-anim', '1');
    document.head.appendChild(style);
  }
}

// Main App
function App() {
  // --- STATE MANAGEMENT (Professional structure) ---
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
  const [currencyRates, setCurrencyRates] = useState(null);
  const [theme, setTheme] = useState('light');
  const [mobileMenuScrollPos, setMobileMenuScrollPos] = useState(0);
  const mobileNavRef = useRef(null);
  const [isDashboardRefreshing, setIsDashboardRefreshing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // ... (form states and other hooks will go here in next chunk)
  // --- FORM STATES ---
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
  const [adminGrantTokenForm, setAdminGrantTokenForm] = useState({
    user_id: '',
    token_name: ''
  });
  const [adminBoostTokenForm, setAdminBoostTokenForm] = useState({
    token_id: ''
  });
  const [selectedUserForBoost, setSelectedUserForBoost] = useState('');
  const [selectedUserForBoostTokens, setSelectedUserForBoostTokens] = useState([]);

  // --- THEME EFFECT & UTILITY HOOKS ---
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // --- PROFESSIONAL NOTIFICATION WITH ANIMATION ---
  const showNotification = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  };

  // --- PROFESSIONAL COPY TO CLIPBOARD ---
  const copyReferralLink = () => {
    if (!currentUser?.referral_code) return;
    const referralLink = `${window.location.origin}?ref=${currentUser.referral_code}`;
    navigator.clipboard.writeText(referralLink);
    showNotification('Referral link copied to clipboard! 📋', 'success');
  };

  // --- PROFESSIONAL CURRENCY FORMATTER ---
  const formatCurrency = (amountInUSD, explicitTargetCurrency = null) => {
    const targetCurrency = explicitTargetCurrency || currentUser?.preferred_currency || 'USD';
    let displayAmount = amountInUSD;
    if (!currencyRates || !Object.keys(supportedCurrencies).length) {
      const usdInfo = supportedCurrencies['USD'] || { name: "US Dollar", symbol: "$" };
      return `${usdInfo.symbol}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, }).format(amountInUSD || 0)} (USD)`;
    }
    if (targetCurrency !== 'USD' && currencyRates[targetCurrency]) {
      displayAmount = amountInUSD * currencyRates[targetCurrency];
    } else if (targetCurrency !== 'USD' && !currencyRates[targetCurrency] && amountInUSD !== 0) {
      const usdInfo = supportedCurrencies['USD'] || { symbol: '$' };
      return `${usdInfo.symbol}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountInUSD || 0)} (USD)`;
    }
    const currencyInfo = supportedCurrencies[targetCurrency] || { symbol: '$' };
    if (amountInUSD === Infinity) return `∞ ${targetCurrency}`;
    return `${currencyInfo.symbol}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(displayAmount || 0)}`;
  };

  // --- PROFESSIONAL WITHDRAWAL TIMER ---
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

  // --- ONBOARDING MODAL (ANIMATED) ---
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
      <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 animate-fade-in">
        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-8 text-center shadow-2xl animate-fade-in-up relative">
          <button
            onClick={() => setShowOnboarding(false)}
            className="absolute top-0 right-0 mt-4 mr-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            aria-label="Close onboarding"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
          <div className="text-6xl mb-4 animate-fade-in">{currentStep.icon}</div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 animate-fade-in-up">{currentStep.title}</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-8 animate-fade-in-up">{currentStep.content}</p>
          <div className="flex justify-center space-x-2 mb-6">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`w-2 h-2 rounded-full transition-colors duration-500 ${index === onboardingStep ? 'bg-blue-600 scale-125' : 'bg-gray-300'}`}
              />
            ))}
          </div>
          <div className="flex space-x-4">
            {onboardingStep > 0 && (
              <button
                onClick={() => setOnboardingStep(onboardingStep - 1)}
                className="flex-1 py-3 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition shadow hover:scale-105"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (onboardingStep < steps.length - 1) {
                  setOnboardingStep(onboardingStep + 1);
                } else {
                  localStorage.setItem('onboarding_completed', 'true');
                  setShowOnboarding(false);
                  showNotification('Welcome to ProfitPilot! Start earning now! 🚀', 'success');
                }
              }}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium transition transform hover:scale-105"
            >
              {onboardingStep < steps.length - 1 ? 'Next' : 'Start Mining!'}
            </button>
          </div>
        </div>
      </div>
    );
  };
  // --- AUTH / SESSION MANAGEMENT & INITIAL LOAD HOOKS ---
  useEffect(() => {
    // Parse referral and reference codes from URL
    const urlParams = new URLSearchParams(window.location.search);
    const referralCode = urlParams.get('ref');
    if (referralCode) {
      setAuthForm(prev => ({ ...prev, referralCode }));
      setAuthMode('register');
    }
    const reference = urlParams.get('reference');
    if (reference) handlePaymentVerification(reference);

    // Load user session if token exists
    const token = localStorage.getItem('profitpilot_token');
    if (token) {
      fetchDashboard(token);
    } else {
      setShowAuth(true);
    }
    // Load supported currencies
    fetchSupportedCurrencies();
    // eslint-disable-next-line
  }, []);

  // Auto-refresh dashboard & notifications
  useEffect(() => {
    if (!showAuth && currentUser) {
      const interval = setInterval(() => {
        fetchDashboard(null, { isBackgroundRefresh: true });
        if (!currentUser.is_admin) fetchUserNotifications();
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [showAuth, currentUser]);

  // Show mining earning notification if earnings increased
  useEffect(() => {
    if (currentUser && lastEarnings > 0 && currentUser.total_earnings > lastEarnings) {
      const difference = currentUser.total_earnings - lastEarnings;
      showNotification(`🎉 Mining completed! You earned $${difference.toFixed(2)}!`, 'success');
    }
    if (currentUser) setLastEarnings(currentUser.total_earnings);
  }, [currentUser?.total_earnings]);

  // Mining countdown timer with smooth updates
  useEffect(() => {
    if (dashboardData?.next_mining) {
      const timer = setInterval(() => {
        const now = new Date();
        const nextMining = new Date(dashboardData.next_mining);
        const diff = nextMining - now;
        if (diff <= 0) {
          setMiningCountdown('Mining now! 🎉');
          setTimeout(() => fetchDashboard(null, { isBackgroundRefresh: true }), 5000);
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

  // --- CURRENCY & DASHBOARD DATA LOADERS ---
  const fetchSupportedCurrencies = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/currencies`);
      setSupportedCurrencies(response.data.currencies);
      setCurrencyRates(response.data.rates);
    } catch (error) {
      setCurrencyRates({"USD": 1});
      showNotification('Error fetching currency rates. Defaulting to USD.', 'warning');
    }
  };

  const fetchDashboard = async (token = null, options = { isBackgroundRefresh: false }) => {
    const { isBackgroundRefresh } = options;
    try {
      if (!isBackgroundRefresh) setLoading(true); else setIsDashboardRefreshing(true);
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/dashboard`, { headers: { Authorization: `Bearer ${authToken}` } });
      setDashboardData(response.data);
      setCurrentUser(response.data.user);
      setTheme(response.data.user.theme || 'light');
      setProfileForm({
        preferred_currency: response.data.user.preferred_currency || 'USD',
        theme: response.data.user.theme || 'light',
        notifications_enabled: response.data.user.notifications_enabled !== false
      });
      setShowAuth(false);
      if (response.data.user.tokens_owned === 1 && !localStorage.getItem('onboarding_completed')) setShowOnboarding(true);
      if (!response.data.user.is_admin) {
        fetchUserNotifications(authToken);
        fetchUserTasks(authToken);
      }
    } catch (error) {
      if (error.response?.status === 401) {
        localStorage.removeItem('profitpilot_token');
        setShowAuth(true);
      } else {
        showNotification('Failed to load dashboard data', 'error');
      }
    } finally {
      if (!isBackgroundRefresh) setLoading(false); else setIsDashboardRefreshing(false);
    }
  };

  const fetchUserNotifications = async (token = null) => {
    try {
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/notifications`, { headers: { Authorization: `Bearer ${authToken}` } });
      setUserNotifications(response.data.notifications);
      setUnreadCount(response.data.unread_count);
    } catch { /* silently ignore, handled in UI */ }
  };

  const fetchUserTasks = async (token = null) => {
    try {
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/tasks?_cb=${new Date().getTime()}`,
        { headers: { Authorization: `Bearer ${authToken}` } });
      setUserTasks(response.data.tasks);
    } catch {}
  };

  // --- END OF CHUNK 2 ---
  // --- AUTH HANDLERS & LOGIC ---
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

  // --- PROFESSIONAL PROFILE UPDATE ---
  const handleProfileUpdate = async (e) => {
    if (e.preventDefault) e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/profile/update`, profileForm, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTheme(profileForm.theme);
      showNotification('Profile updated successfully!', 'success');
      fetchDashboard();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to update profile', 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- ADMIN & TASKS ---
  const fetchLeaderboard = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/leaderboard`);
      setLeaderboardData(response.data);
    } catch { /* silent fail for now */ }
  };

  // ... Place all admin workspace handlers, sendBalance, createTask, broadcast, grant/boost token, fetchUserDetails, etc. here (use your previous logic, now refactored and animated as needed) ...

  // --- PAYMENT HANDLERS ---
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
      showNotification(error.response?.data?.detail || 'Payment initialization failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentVerification = async (reference) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(
        `${BACKEND_URL}/api/payment/verify`,
        { reference },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification('Payment successful! 🎉', 'success');
      fetchDashboard();
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch {
      showNotification('Payment verification failed', 'error');
    }
  };
  // --- ADMIN & ADVANCED HANDLERS (workspace/task/broadcast/token tools) ---
  // (The following are refactored for clarity and animation readiness)
  // Adjust these functions as needed for your backend API details

  const fetchAdminDashboard = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminDashboard(response.data);
    } catch {}
  };

  const fetchAdminUsers = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminUsers(response.data.users);
    } catch {}
  };

  const fetchUserDetails = async (userId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedUser(response.data);
    } catch {}
  };

  const fetchAdminTasks = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminTasks(response.data.tasks);
    } catch {}
  };

  const fetchAdminBroadcasts = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/broadcasts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminBroadcasts(response.data.broadcasts);
    } catch {}
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

  // Grant/Boost Token helpers
  const fetchTokensForUserBoostSelection = async (userId) => {
    if (!userId) {
      setSelectedUserForBoostTokens([]);
      setAdminBoostTokenForm(prev => ({ ...prev, token_id: '' }));
      return;
    }
    setSelectedUserForBoost(userId);
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/workspace/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedUserForBoostTokens(response.data.tokens || []);
      setAdminBoostTokenForm(prev => ({ ...prev, token_id: '' }));
    } catch {
      showNotification('Failed to fetch user tokens for boosting.', 'error');
      setSelectedUserForBoostTokens([]);
    }
  };

  const handleAdminGrantToken = async (e) => {
    e.preventDefault();
    if (!adminGrantTokenForm.user_id) {
      showNotification('User ID is required.', 'error');
      return;
    }
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const payload = {
        user_id: adminGrantTokenForm.user_id,
        token_name: adminGrantTokenForm.token_name.trim() || "Admin Granted Token"
      };
      const response = await axios.post(`${BACKEND_URL}/api/admin/workspace/users/grant-token`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setAdminGrantTokenForm({ user_id: '', token_name: '' });
      if (selectedUser && selectedUser.user.user_id === payload.user_id) {
        fetchUserDetails(payload.user_id);
      }
      fetchAdminUsers();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to grant token', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminBoostToken = async (e) => {
    e.preventDefault();
    if (!adminBoostTokenForm.token_id) {
      showNotification('Token ID is required.', 'error');
      return;
    }
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const payload = { token_id: adminBoostTokenForm.token_id };
      const response = await axios.post(`${BACKEND_URL}/api/admin/workspace/tokens/boost-token`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setAdminBoostTokenForm({ token_id: '' });
      setSelectedUserForBoostTokens([]);
      setSelectedUserForBoost('');
      fetchAdminUsers();
      if (selectedUser && selectedUser.user.user_id === selectedUserForBoost) {
        fetchUserDetails(selectedUser.user.user_id);
      }
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to boost token', 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- MARK NOTIFICATION READ & TASK COMPLETION ---
  const markNotificationRead = async (notificationId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/notifications/${notificationId}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchUserNotifications();
    } catch {}
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

  // --- UI: MOBILE MENU (Animated) ---
  const MobileMenu = () => (
    <div className={`fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden ${showMobileMenu ? 'block' : 'hidden'} animate-fade-in`}>
      <div className="fixed inset-y-0 left-0 w-80 bg-white dark:bg-gray-800 shadow-lg animate-fade-in-up transition-all duration-500">
        <div className="p-6 border-b dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center">
                <span className="text-white text-lg font-bold">P</span>
              </div>
              <span className="ml-3 text-xl font-bold text-gray-800 dark:text-white">ProfitPilot</span>
            </div>
            <button
              onClick={() => {
                if (mobileNavRef.current) setMobileMenuScrollPos(mobileNavRef.current.scrollTop);
                setShowMobileMenu(false);
              }}
              className="text-gray-500 dark:text-gray-400 text-xl"
            >
              ✕
            </button>
          </div>
          <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <p className="text-sm font-medium text-gray-800 dark:text-white">{currentUser?.user_id}</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">{formatCurrency(currentUser?.total_earnings_converted || 0)}</p>
          </div>
        </div>
        <nav ref={mobileNavRef} className="p-4 space-y-2 max-h-96 overflow-y-auto">
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
                if (mobileNavRef.current) setMobileMenuScrollPos(mobileNavRef.current.scrollTop);
                setActiveTab(item.id);
                setShowMobileMenu(false);
              }}
              className={`w-full text-left p-4 rounded-xl transition-colors duration-300 ${
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
    // --- AUTH PAGE (ANIMATED DESIGN) ---
  if (showAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center p-4 animate-fade-in">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-8 animate-fade-in-up transition-transform duration-700">
          <div className="text-center mb-8">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-fade-in">
              <span className="text-white text-2xl font-bold">P</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white animate-fade-in-up">ProfitPilot</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2 animate-fade-in-up">Professional crypto earnings platform</p>
            <div className="mt-6 space-y-3 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex items-center justify-center space-x-2">
                <span>⛏️</span>
                <span> Your Automated mining platform</span>
              </div>
            </div>
          </div>
          <div className="flex mb-6">
            <button
              className={`flex-1 py-3 px-4 rounded-l-lg font-medium transition-colors duration-300 ${authMode === 'login' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              className={`flex-1 py-3 px-4 rounded-r-lg font-medium transition-colors duration-300 ${authMode === 'register' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
              onClick={() => setAuthMode('register')}
            >
              Register
            </button>
          </div>
          <form onSubmit={handleAuth} className="space-y-4 animate-fade-in-up">
            <div>
              <input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                className="w-full p-4 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base transition-all"
                required
              />
            </div>
            <div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={authForm.password}
                  onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                  className="w-full p-4 pr-12 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-sm leading-5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7 1.274-4.057 5.064-7 9.542-7 .847 0 1.668.124 2.458.352M7.5 7.5l9 9M3.75 3.75l16.5 16.5"></path></svg>
                  )}
                </button>
              </div>
            </div>
            {authMode === 'register' && (
              <div>
                <input
                  type="text"
                  placeholder="Referral Code (Optional)"
                  value={authForm.referralCode}
                  onChange={(e) => setAuthForm({...authForm, referralCode: e.target.value})}
                  className="w-full p-4 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base transition-all"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Enter a friend's referral code to earn $2 bonus!</p>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 text-base transition-all"
            >
              {loading ? 'Processing...' : (authMode === 'login' ? 'Login' : 'Register & Start Mining')}
            </button>
          </form>
          {authMode === 'register' && (
            <div className="mt-6 p-4 bg-green-50 dark:bg-green-900 rounded-lg animate-fade-in">
              <p className="text-sm text-green-700 dark:text-green-300 text-center">
                🎁 <strong>Free Token:</strong> Get your first mining token absolutely free when you register!
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
  // --- MAIN APP RETURN ---
  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300`}>
      {showOnboarding && <OnboardingModal />}
      <NotificationContainer notifications={notifications} />
      <MobileMenu />

      {/* HEADER (animated and professional) */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30 animate-fade-in">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <button
                onClick={() => setShowMobileMenu(true)}
                className="lg:hidden p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                ☰
              </button>
              <div className="flex items-center ml-2 lg:ml-0">
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center animate-fade-in-up">
                  <span className="text-white text-lg font-bold">P</span>
                </div>
                <span className="ml-3 text-xl font-bold text-gray-800 dark:text-white animate-fade-in-up">ProfitPilot</span>
                <span className="ml-2 text-xs bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300 px-2 py-1 rounded-full font-medium animate-fade-in">LIVE</span>
                {currentUser?.is_admin && (
                  <span className="ml-2 text-xs bg-purple-100 dark:bg-purple-800 text-purple-600 dark:text-purple-300 px-2 py-1 rounded-full font-medium animate-fade-in">ADMIN</span>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4">
              {!currentUser?.is_admin && miningCountdown && (
                <div className="hidden sm:flex items-center space-x-2 bg-orange-50 dark:bg-orange-900 rounded-lg px-3 py-1 animate-fade-in-up">
                  <span className="text-sm text-orange-600 dark:text-orange-300">Next:</span>
                  <span className="text-sm font-bold text-orange-600 dark:text-orange-300">{miningCountdown}</span>
                </div>
              )}
              {!currentUser?.is_admin && unreadCount > 0 && (
                <button
                  onClick={() => setActiveTab('notifications')}
                  className="relative bg-blue-50 dark:bg-blue-900 hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-600 dark:text-blue-400 text-sm px-3 py-2 rounded-lg font-medium transition"
                >
                  🔔
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount}
                  </span>
                </button>
              )}
              <div className="hidden md:flex items-center space-x-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-1 animate-fade-in-up">
                <span className="text-sm text-gray-600 dark:text-gray-400">Balance:</span>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(currentUser?.total_earnings_converted || currentUser?.total_earnings || 0)}
                </span>
              </div>
              {!currentUser?.is_admin && (
                <div className="hidden sm:flex items-center space-x-2 bg-blue-50 dark:bg-blue-900 rounded-lg px-3 py-1 animate-fade-in-up">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Tokens:</span>
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{currentUser?.tokens_owned || 0}/5</span>
                </div>
              )}
              <button
                onClick={() => {
                  const newTheme = theme === 'light' ? 'dark' : 'light';
                  setTheme(newTheme);
                  setProfileForm(prev => ({ ...prev, theme: newTheme }));
                  handleProfileUpdate({ preventDefault: () => {} });
                }}
                className="hidden lg:flex items-center space-x-1 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400 text-sm px-3 py-2 rounded-lg font-medium transition"
              >
                <span>{theme === 'light' ? '🌙' : '☀️'}</span>
              </button>
              <div className="hidden lg:block text-right animate-fade-in-up">
                <div className="text-sm font-medium text-gray-800 dark:text-white">{currentUser?.user_id}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{currentUser?.email}</div>
              </div>
              <button
                onClick={handleLogout}
                className="bg-red-50 dark:bg-red-900 hover:bg-red-100 dark:hover:bg-red-800 text-red-600 dark:text-red-400 text-sm px-3 py-2 rounded-lg font-medium transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>
      {/* DESKTOP NAVIGATION */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 hidden lg:block animate-fade-in">
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
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors duration-300 ${
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
      {/* MAIN CONTENT - PROFESSIONAL ANIMATED TABS */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fade-in-up transition-all">
        {activeTab === 'home' && dashboardData && (
          <div className="space-y-6">
            {/* Welcome Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl text-white p-6 sm:p-8 shadow-xl animate-fade-in-up">
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
                  <div className="bg-white bg-opacity-20 rounded-lg p-3 animate-fade-in-up">
                    <span className="text-2xl">{currentUser?.is_admin ? '⚙️' : '✨'}</span>
                  </div>
                </div>
              </div>
              {!currentUser?.is_admin && miningCountdown && (
                <div className="mt-6 sm:hidden bg-white bg-opacity-20 rounded-lg p-3 text-center animate-fade-in">
                  <p className="text-blue-100 text-sm">Next Mining</p>
                  <p className="text-lg font-bold">{miningCountdown}</p>
                </div>
              )}
              <div className="mt-4 flex items-center justify-center sm:justify-start space-x-2 text-blue-100 text-sm animate-fade-in">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span>Professional automated system</span>
              </div>
            </div>
            {/* DASHBOARD CARDS AND ONBOARDING */}
            {!currentUser?.is_admin && (
              <>
                <div className="grid grid-cols-2 gap-4 sm:hidden">
                  <button
                    onClick={() => setActiveTab('tokens')}
                    className="bg-white dark:bg-gray-800 rounded-xl p-4 text-center shadow-sm border dark:border-gray-700 animate-fade-in-up"
                  >
                    <div className="text-2xl mb-2">🪙</div>
                    <div className="text-sm font-medium text-gray-800 dark:text-white">My Tokens</div>
                  </button>
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className="bg-white dark:bg-gray-800 rounded-xl p-4 text-center shadow-sm border dark:border-gray-700 relative animate-fade-in-up"
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
                {/* Earnings, Tokens, Referrals, Boosts */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 animate-fade-in-up">
                  <div className="bg-green-50 dark:bg-green-900 rounded-xl p-4 lg:p-6 animate-fade-in">
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
                  <div className="bg-blue-50 dark:bg-blue-900 rounded-xl p-4 lg:p-6 animate-fade-in">
                    <div className="flex items-center justify-between mb-2 lg:mb-4">
                      <div className="bg-blue-500 rounded-lg p-2">
                        <span className="text-white text-sm lg:text-lg">🔗</span>
                      </div>
                      <span className="text-blue-600 dark:text-blue-400 text-xs font-medium">{currentUser.tokens_owned}/5</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-xs lg:text-sm mb-1">Active Tokens</p>
                    <p className="text-lg lg:text-2xl font-bold text-gray-800 dark:text-white">{currentUser.tokens_owned}</p>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-900 rounded-xl p-4 lg:p-6 animate-fade-in">
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
                  <div className="bg-orange-50 dark:bg-orange-900 rounded-xl p-4 lg:p-6 animate-fade-in">
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
              </>
            )}
          </div>
        )}

        {/* Add your other animated tab content here (workspace, tasks, notifications, referrals, profile, board, help, etc.) */}
        {/* ... Paste the rest of your professional tab content code as in your original, with animate-fade-in/animate-fade-in-up added to each major content block for smooth entry ... */}

      </main>
    </div>
  );
}

export default App;
