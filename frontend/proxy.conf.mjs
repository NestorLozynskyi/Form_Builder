// Dev-server proxy: forwards /api to the backend. Override with API_PROXY_TARGET.
export default {
  '/api': {
    target: process.env.API_PROXY_TARGET ?? 'http://localhost:5180',
    secure: false,
    changeOrigin: true,
  },
};
