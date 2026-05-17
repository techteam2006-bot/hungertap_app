import { Image } from 'react-native';

// Image cache for better performance
const imageCache = new Set();

// Configure image caching for better performance
export const configureImageCache = () => {
  // Enable image caching
  Image.getSize = Image.getSize || (() => {});
  
  // Preload common images
  const commonImages = [
    'https://imgs.search.brave.com/H0EimZaFKTJOiXJSOVv8oSPdubhwLF8M2SSwS__EhPM/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90NC5m/dGNkbi5uZXQvanBn/LzA5LzE1LzIyLzk5/LzM2MF9GXzkxNTIy/OTk0M18yNnlGb0FJ/ZEVsUjVRMWNmNXF1/WkswNGp6RldNY2Jy/OS5qcGc', // Veg Biryani
  ];

  // Preload images in background
  commonImages.forEach(uri => {
    if (!imageCache.has(uri)) {
      Image.prefetch(uri)
        .then(() => {
          imageCache.add(uri);
        })
        .catch(() => {
          // Ignore prefetch errors
        });
    }
  });
};

// Preload specific image
export const preloadImage = (uri) => {
  if (!uri || imageCache.has(uri)) return Promise.resolve();
  
  return Image.prefetch(uri)
    .then(() => {
      imageCache.add(uri);
    })
    .catch(() => {
      // Ignore prefetch errors
    });
};

// Check if image is cached
export const isImageCached = (uri) => {
  return imageCache.has(uri);
};

// Clear image cache when needed
export const clearImageCache = () => {
  imageCache.clear();
};
