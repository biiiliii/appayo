// Punt d'entrada de Vercel. Les rutes /api/v1/* hi arriben per vercel.json.
import { handleApi } from '../backend/api.js';

export default {
  fetch(request) {
    const url = new URL(request.url);
    return handleApi(request, `/api/v1/${url.searchParams.get('path') ?? ''}`);
  },
};
