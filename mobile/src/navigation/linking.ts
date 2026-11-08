import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/** `recallsmith` is registered as the app scheme in app.json (B01). */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['recallsmith://'],
  config: {
    screens: {
      Home: 'home',
      Draw: 'draw/:slug?',
      Library: 'library',
      CardDetail: 'card/:cardId',
      DrawResult: 'result/:slug',
      Paywall: 'paywall',
      SignIn: 'signin',
      SignUp: 'signup',
      ConfirmSignUp: 'confirm-signup',
      ForgotPassword: 'forgot-password',
      Settings: 'settings',
      HelpFAQ: 'help',
      Profile: 'profile',
    },
  },
};
