import { Platform } from 'react-native';

export const colors = {
  bg: '#F6F7F2', white: '#FFFFFF', ink: '#1D332A', muted: '#718075',
  green: '#245C44', lightGreen: '#E9EFE5', border: '#E2E7DD', orange: '#CF7947',
  danger: '#B1493A',
};
export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });
export const covers = {
  bali: require('../../assets/covers/bali.jpg'),
  mountains: require('../../assets/covers/mountains.jpg'),
  city: require('../../assets/covers/city.jpg'),
  beach: require('../../assets/covers/beach.jpg'),
};
