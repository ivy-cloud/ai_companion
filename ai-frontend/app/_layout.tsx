import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { Component, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

type ErrorBoundaryState = { error: Error | null };

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error('Unknown startup error');
  }
}

function StartupErrorView({ error }: { error: Error }) {
  const detail = error.stack?.trim() || `${error.name}: ${error.message}`;

  return (
    <SafeAreaView style={styles.errorContainer} edges={['top', 'bottom', 'left', 'right']}>
      <Text style={styles.errorTitle}>App failed to start</Text>
      <Text style={styles.errorHint}>Share this message from Expo Go:</Text>
      <Text style={styles.errorMessage} selectable>
        {error.name}: {error.message}
      </Text>
      <ScrollView style={styles.errorScroll} contentContainerStyle={styles.errorScrollContent}>
        <Text style={styles.errorStack} selectable>
          {detail}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

class RootErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: normalizeError(error) };
  }

  componentDidCatch(error: unknown) {
    console.error('[startup]', normalizeError(error));
  }

  render() {
    if (this.state.error) {
      return <StartupErrorView error={this.state.error} />;
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ error }: ErrorBoundaryProps) {
  return <StartupErrorView error={normalizeError(error)} />;
}

export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="settings" />
        </Stack>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    backgroundColor: '#faf7f5',
    padding: 24,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 12,
  },
  errorHint: {
    fontSize: 14,
    color: '#4a3f42',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 15,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 12,
    lineHeight: 22,
  },
  errorScroll: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ead9d4',
  },
  errorScrollContent: {
    padding: 12,
  },
  errorStack: {
    fontSize: 12,
    color: '#7f1d1d',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },
});
