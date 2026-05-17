import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useTheme } from '../lib/ThemeContext';

export default function SupportScreen({ navigation }) {
  const { colors } = useTheme();
  const [messages, setMessages] = useState([
    { id: 'welcome', role: 'system', text: 'Welcome to Support. How can we help?' }
  ]);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  const [showResetPrompt, setShowResetPrompt] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const userMsg = { id: String(Date.now()), role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    // Placeholder bot response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now() + 1), role: 'bot', text: 'Thanks! A support agent will respond shortly.' }
      ]);
      if (scrollRef.current) {
        scrollRef.current.scrollToEnd({ animated: true });
      }
    }, 400);
  };

  const handleFaqPress = (type) => {
    let text = '';
    setShowResetPrompt(false);
    if (type === 'signin') {
      text = 'If you are unable to sign in, please try resetting your password or check your internet connection. Do you want me to redirect you to the password reset page?';
      setShowResetPrompt(true);
    } else if (type === 'app') {
      text = 'For app issues, please try updating to the latest version. If the issue persists, contact support.';
    } else if (type === 'feedback') {
      text = 'We value your feedback! Please type your feedback below and press send.';
    }
    if (text) {
      setMessages((prev) => [...prev, { id: String(Date.now()), role: 'bot', text }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const handleResetYes = () => {
    setMessages((prev) => [
      ...prev,
      { id: String(Date.now()), role: 'user', text: 'Yes, redirect me.' },
      { id: String(Date.now() + 1), role: 'bot', text: 'Taking you to the password reset page...' },
    ]);
    setShowResetPrompt(false);
    setTimeout(() => {
      navigation?.navigate && navigation.navigate('ForgotPassword');
    }, 150);
  };

  const handleResetNo = () => {
    setMessages((prev) => [
      ...prev,
      { id: String(Date.now()), role: 'user', text: 'No, thanks.' },
      { id: String(Date.now() + 1), role: 'bot', text: 'Okay, let me know if you need anything else.' },
    ]);
    setShowResetPrompt(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.contentBackground }]}> 
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* White status bar strip */}
        <View style={[styles.whiteStrip, { height: Constants.statusBarHeight, backgroundColor: colors.brandYellow }]} />
        <View style={[styles.header, { borderBottomColor: colors.border }]}> 
          <Text style={[styles.title, { color: colors.text }]}>Support Chatbot</Text>
        </View>

        {/* FAQ options */}
        <View style={styles.faqRow}>
          <TouchableOpacity style={[styles.faqChip, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleFaqPress('signin')}>
            <Text style={[styles.faqText, { color: colors.text }]}>Sign-in Issues</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.faqChip, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleFaqPress('app')}>
            <Text style={[styles.faqText, { color: colors.text }]}>App Related Issues</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.faqChip, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleFaqPress('feedback')}>
            <Text style={[styles.faqText, { color: colors.text }]}>Feedback</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.chat}
          contentContainerStyle={styles.chatContent}
          ref={scrollRef}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.bubble,
                m.role === 'user' ? styles.userBubble : styles.botBubble,
                {
                  backgroundColor: m.role === 'user' ? colors.primary : colors.card,
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                },
              ]}
            >
              <Text style={{ color: m.role === 'user' ? colors.background : colors.text }}>{m.text}</Text>
            </View>
          ))}

          {showResetPrompt && (
            <View style={[styles.resetRow]}> 
              <TouchableOpacity style={[styles.resetBtn, { backgroundColor: colors.primary }]} onPress={handleResetYes}>
                <Text style={[styles.resetBtnText, { color: colors.background }]}>Yes, redirect</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.resetBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} onPress={handleResetNo}>
                <Text style={[styles.resetBtnText, { color: colors.text }]}>No</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        <View style={[styles.inputRow, { borderTopColor: colors.border }]}> 
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Type your message"
            placeholderTextColor={colors.textSecondary}
            value={input}
            onChangeText={setInput}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
          />
          <TouchableOpacity style={[styles.sendBtn, { backgroundColor: colors.primary }]} onPress={sendMessage}>
            <Text style={[styles.sendText, { color: '#FFFFFF' }]}>Send</Text>
          </TouchableOpacity>
        </View>

        {/* Search overlay above keyboard when typing */}
        {isFocused && input.trim().length > 0 && (
          <View style={[styles.searchOverlay, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.searchText, { color: colors.textSecondary }]} numberOfLines={1}>
              Searching for: {input}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  whiteStrip: {
    width: '100%',
  },
  title: { fontSize: 18, fontWeight: '700' },
  faqRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  faqChip: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  faqText: { fontSize: 13, fontWeight: '600' },
  chat: { flex: 1 },
  chatContent: { padding: 16 },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 8,
    maxWidth: '80%',
  },
  userBubble: {},
  botBubble: {},
  resetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  resetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  resetBtnText: { fontWeight: '700' },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    padding: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
  },
  sendBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontWeight: '700' },
  searchOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 64,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchText: { fontSize: 13 },
});


