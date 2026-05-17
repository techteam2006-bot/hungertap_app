// utils/percent.js
import { Dimensions } from 'react-native';
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Replace with actual logged values from Poco M4 Pro (use console.log(Dimensions.get('window')))
const REF_W = 1080; 
const REF_H = 2400; 

export const pxToPercentX = (px) => `${(px / REF_W) * 100}%`;
export const pxToPercentY = (px) => `${(px / REF_H) * 100}%`;



