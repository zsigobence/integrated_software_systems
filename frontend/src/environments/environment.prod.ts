export const environment = {
  production: true,
  serverUrl: `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3000`
};
