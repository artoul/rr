import axios from 'https://cdn.jsdelivr.net/npm/axios@1.3.5/+esm';

// Initialize with a default value, will be updated once we fetch the config
let API_URL = '';
let api = null;

// Initialize the API with the current origin (since frontend and backend are on same port)
const initAPI = async () => {
  try {
    // Since frontend and backend are on the same port, use relative URLs
    API_URL = '/api';
    
    // Create axios instance with auth token
    api = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000 // Add timeout to avoid long waits on network issues
    });

    // Add auth token to requests if available
    api.interceptors.request.use(config => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
    
    return true;
  } catch (error) {
    console.error('Failed to initialize API:', error);
    return false;
  }
};

// Helper function to ensure API is initialized before making requests
const ensureAPI = async () => {
  if (!api) {
    await initAPI();
  }
  return api;
};

// Auth endpoints
export const login = async (email, password) => {
  const apiInstance = await ensureAPI();
  return apiInstance.post('/auth/login', { email, password });
};

export const register = async (username, email, password) => {
  const apiInstance = await ensureAPI();
  return apiInstance.post('/auth/register', { username, email, password });
};

export const getProfile = async () => {
  const apiInstance = await ensureAPI();
  return apiInstance.get('/auth/me');
};

// Title endpoints
export const createTitle = async (title, instructions) => {
  const apiInstance = await ensureAPI();
  return apiInstance.post('/titles', { title, instructions });
};

export const getTitles = async () => {
  const apiInstance = await ensureAPI();
  return apiInstance.get('/titles');
};

export const getTitle = async (id) => {
  const apiInstance = await ensureAPI();
  return apiInstance.get(`/titles/${id}`);
};

export const updateTitle = async (id, title, instructions) => {
  const apiInstance = await ensureAPI();
  return apiInstance.put(`/titles/${id}`, { title, instructions });
};

export const deleteTitle = async (id) => {
  const apiInstance = await ensureAPI();
  return apiInstance.delete(`/titles/${id}`);
};

// Reference endpoints
export const uploadReference = async (titleId, imageData, isGlobal = false) => {
  const apiInstance = await ensureAPI();
  return apiInstance.post('/references', { titleId, imageData, isGlobal });
};

export const getReferences = async (titleId) => {
  const apiInstance = await ensureAPI();
  return apiInstance.get(`/references/${titleId}`);
};

export const getGlobalReferences = async () => {
  const apiInstance = await ensureAPI();
  return apiInstance.get('/references/global');
};

export const deleteReference = async (id) => {
  const apiInstance = await ensureAPI();
  return apiInstance.delete(`/references/${id}`);
};

// Painting endpoints (renamed from Thumbnail)
export const generateThumbnails = async (titleId, quantity = 5) => {
  const apiInstance = await ensureAPI();
  // Generation can take time (AI idea + image). Increase timeout for this call.
  return apiInstance.post('/paintings/generate', { titleId, quantity }, { timeout: 120000 });
};

export const getThumbnails = async (titleId) => {
  const apiInstance = await ensureAPI();
  return apiInstance.get(`/paintings/${titleId}`);
};

// SSE helper to subscribe to painting updates for a title
export const streamPaintings = (titleId) => {
  const token = localStorage.getItem('token');
  const url = `${API_URL}/paintings/stream/${titleId}?token=${encodeURIComponent(token || '')}`;
  // Use absolute path when API_URL is relative
  return new EventSource(url);
};

// Initialize API when this module is imported
initAPI();

export default async () => ensureAPI(); 