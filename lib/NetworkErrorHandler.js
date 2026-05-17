// Network Error Handler for Canteen App
// Provides user-friendly error messages and recovery suggestions

export class NetworkErrorHandler {
  static getErrorMessage(error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    
    // Network-related errors
    if (errorMessage.includes('Network request failed') || 
        errorMessage.includes('fetch')) {
      return {
        title: 'Network Connection Error',
        message: 'Unable to connect to the server. Please check your internet connection and try again.',
        suggestions: [
          'Check your internet connection',
          'Try switching between WiFi and mobile data',
          'Restart the app',
          'Check if the server is running'
        ],
        type: 'network'
      };
    }
    
    // Supabase-specific errors
    if (errorMessage.includes('Invalid JWT') || 
        errorMessage.includes('JWT')) {
      return {
        title: 'Authentication Error',
        message: 'Your session has expired. Please log in again.',
        suggestions: [
          'Log out and log back in',
          'Clear app data and restart',
          'Check your internet connection'
        ],
        type: 'auth'
      };
    }
    
    if (errorMessage.includes('PGRST116')) {
      return {
        title: 'Data Not Found',
        message: 'The requested information could not be found.',
        suggestions: [
          'Refresh the page',
          'Check if the data exists',
          'Try again later'
        ],
        type: 'data'
      };
    }
    
    if (errorMessage.includes('23505')) {
      return {
        title: 'Duplicate Entry',
        message: 'This item already exists. Please try with different information.',
        suggestions: [
          'Use a different email address',
          'Check if you already have an account',
          'Try logging in instead'
        ],
        type: 'duplicate'
      };
    }
    
    if (errorMessage.includes('23503')) {
      return {
        title: 'Reference Error',
        message: 'The requested item is not available or has been removed.',
        suggestions: [
          'Refresh the page',
          'Check if the item still exists',
          'Try again later'
        ],
        type: 'reference'
      };
    }
    
    // Timeout errors
    if (errorMessage.includes('timeout') || 
        errorMessage.includes('TIMEOUT')) {
      return {
        title: 'Request Timeout',
        message: 'The request took too long to complete. Please try again.',
        suggestions: [
          'Check your internet connection',
          'Try again in a moment',
          'Restart the app if the issue persists'
        ],
        type: 'timeout'
      };
    }
    
    // Server errors
    if (errorMessage.includes('500') || 
        errorMessage.includes('Internal Server Error')) {
      return {
        title: 'Server Error',
        message: 'There was a problem with the server. Please try again later.',
        suggestions: [
          'Wait a few minutes and try again',
          'Check if the service is under maintenance',
          'Contact support if the issue persists'
        ],
        type: 'server'
      };
    }
    
    // Generic error fallback
    return {
      title: 'Something Went Wrong',
      message: 'An unexpected error occurred. Please try again.',
      suggestions: [
        'Check your internet connection',
        'Restart the app',
        'Try again in a few moments',
        'Contact support if the issue persists'
      ],
      type: 'generic'
    };
  }
  
  static getRecoveryActions(errorType) {
    const actions = {
      network: [
        { label: 'Retry', action: 'retry' },
        { label: 'Check Connection', action: 'check_connection' },
        { label: 'Go Offline', action: 'offline_mode' }
      ],
      auth: [
        { label: 'Sign In Again', action: 'reauthenticate' },
        { label: 'Clear Cache', action: 'clear_cache' },
        { label: 'Contact Support', action: 'contact_support' }
      ],
      data: [
        { label: 'Refresh', action: 'refresh' },
        { label: 'Go Back', action: 'navigate_back' },
        { label: 'Try Again', action: 'retry' }
      ],
      duplicate: [
        { label: 'Use Different Info', action: 'modify_input' },
        { label: 'Sign In Instead', action: 'navigate_to_login' },
        { label: 'Contact Support', action: 'contact_support' }
      ],
      reference: [
        { label: 'Refresh', action: 'refresh' },
        { label: 'Go Back', action: 'navigate_back' },
        { label: 'Try Again', action: 'retry' }
      ],
      timeout: [
        { label: 'Retry', action: 'retry' },
        { label: 'Check Connection', action: 'check_connection' },
        { label: 'Try Later', action: 'dismiss' }
      ],
      server: [
        { label: 'Try Again', action: 'retry' },
        { label: 'Check Status', action: 'check_status' },
        { label: 'Contact Support', action: 'contact_support' }
      ],
      generic: [
        { label: 'Retry', action: 'retry' },
        { label: 'Restart App', action: 'restart_app' },
        { label: 'Contact Support', action: 'contact_support' }
      ]
    };
    
    return actions[errorType] || actions.generic;
  }
  
  static shouldRetry(error) {
    const errorMessage = error?.message || '';
    
    // Don't retry for these error types
    const noRetryErrors = [
      'Invalid JWT',
      '23505', // Duplicate entry
      '23503', // Foreign key constraint
      'PGRST116' // Not found
    ];
    
    return !noRetryErrors.some(noRetryError => 
      errorMessage.includes(noRetryError)
    );
  }
  
  static getRetryDelay(attempt) {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    return Math.min(1000 * Math.pow(2, attempt - 1), 16000);
  }
  
  static formatErrorForLogging(error, context = '') {
    const timestamp = new Date().toISOString();
    const errorInfo = {
      timestamp,
      context,
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    };
    
    return `[${timestamp}] ${context}: ${JSON.stringify(errorInfo, null, 2)}`;
  }
}

export default NetworkErrorHandler;


