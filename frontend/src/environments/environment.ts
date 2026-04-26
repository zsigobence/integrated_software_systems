export const environment = {
  production: false,
  serverUrl: `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3000`
};
