import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

/**
 * Catches React render/lifecycle errors in children so the shell can recover without a hard OS kill.
 */

// ✅ crash prevention added
export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', stack: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || String(error || 'Unknown error'),
      stack: error?.stack || '',
    };
  }

  componentDidCatch(error, info) {
    // ✅ error handled
    console.error('[AppErrorBoundary]', error?.message || error, info?.componentStack || '');
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: '', stack: '' });
    this.props?.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container} testID="app-error-boundary">
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            HungerTap recovered from an unexpected UI error. You can try again. Details were logged for debugging.
          </Text>
          {__DEV__ && this.state.message ? (
            <Text style={styles.dev}>{this.state.message}</Text>
          ) : null}
          <TouchableOpacity style={styles.button} onPress={this.handleRetry} activeOpacity={0.8}>
            <Text style={styles.buttonLabel}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  dev: {
    fontSize: 12,
    color: '#fca5a5',
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#eab308',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonLabel: {
    color: '#0f172a',
    fontWeight: '600',
    fontSize: 16,
  },
});
