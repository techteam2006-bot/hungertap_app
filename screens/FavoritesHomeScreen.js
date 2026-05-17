import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions } from '@react-navigation/native';
import { useTheme } from '../lib/ThemeContext';
import { useFavorites } from '../lib/FavoritesContext';

const { width } = Dimensions.get('window');
const numColumns = 2;
const itemWidth = (width - 48) / numColumns; // 48 = padding (16 * 2) + gap (16)

const FavoritesHomeScreen = ({ navigation }) => {
  const { colors } = useTheme();
  const { favorites, removeFromFavorites, isFavorite } = useFavorites();

  const renderFavoriteItem = ({ item }) => (
    <TouchableOpacity
      style={styles.foodItem}
      onPress={() => navigation.navigate('ItemDetail', { item })}
    >
      <View style={styles.itemDetails}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemName} numberOfLines={2}>
            {item.name}
          </Text>
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={() => removeFromFavorites(item.id)}
          >
            <Ionicons 
              name="heart" 
              size={20} 
              color="#ff4757" 
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.itemDescription} numberOfLines={2}>
          {item.description}
        </Text>
        <View style={styles.itemFooter}>
          <Text style={styles.itemPrice}>₹{item.price}</Text>
          <TouchableOpacity
            style={styles.addToCartButton}
            onPress={() => navigation.navigate('ItemDetail', { item })}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    gradientBar: {
      height: 40,
      width: '100%',
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: 36,
      paddingBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: colors.text,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      flex: 1,
      paddingHorizontal: 16,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 48,
    },
    emptyIcon: {
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 24,
    },
    browseButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 12,
    },
    browseButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '500',
    },
    foodItem: {
      width: itemWidth,
      backgroundColor: colors.card,
      borderRadius: 16,
      marginBottom: 16,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    itemHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 8,
    },
    favoriteButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: 'rgba(255, 255, 255, 0.9)',
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: 8,
    },
    itemDetails: {
      padding: 12,
    },
    itemName: {
      fontSize: 14,
      fontWeight: 'bold',
      color: colors.text,
      marginBottom: 4,
    },
    itemDescription: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 16,
      marginBottom: 8,
    },
    itemFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    itemPrice: {
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.primary,
    },
    addToCartButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addMoreButton: {
      position: 'absolute',
      bottom: 20,
      left: 16,
      right: 16,
      backgroundColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      borderRadius: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    addMoreButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600',
      marginLeft: 8,
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#f97316', '#ef4444']}
        style={styles.gradientBar}
      />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Favorites</Text>
        <View style={{ width: 40 }} />
      </View>
      
      <View style={styles.content}>
        {favorites.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons
              name="heart-outline"
              size={64}
              color={colors.textTertiary}
              style={styles.emptyIcon}
            />
            <Text style={styles.emptyTitle}>No favorites yet</Text>
            <Text style={styles.emptySubtitle}>
              Start adding your favorite dishes to see them here
            </Text>
            <TouchableOpacity
              style={styles.browseButton}
              onPress={() => {
                navigation.dispatch(
                  CommonActions.reset({
                    index: 0,
                    routes: [{ name: 'MainTabs' }],
                  })
                );
              }}
            >
              <Text style={styles.browseButtonText}>Browse Menu</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <FlatList
              data={favorites}
              renderItem={renderFavoriteItem}
              keyExtractor={(item) => item.id}
              numColumns={numColumns}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 80 }}
              columnWrapperStyle={{ justifyContent: 'space-between' }}
            />
            <TouchableOpacity
              style={styles.addMoreButton}
              onPress={() => {
                navigation.dispatch(
                  CommonActions.reset({
                    index: 0,
                    routes: [{ name: 'MainTabs' }],
                  })
                );
              }}
            >
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.addMoreButtonText}>Add More Favorites</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

export default FavoritesHomeScreen; 