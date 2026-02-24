// services/tempStorageService.js
// Simple in-memory storage with cleanup
const bookingContexts = new Map();
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Auto cleanup every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, context] of bookingContexts.entries()) {
    if (context.expiresAt < now) {
      bookingContexts.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

export const tempStorageService = {
  setBookingContext: (key, data) => {
    bookingContexts.set(key, {
      ...data,
      expiresAt: Date.now() + CLEANUP_INTERVAL
    });
    return key;
  },
  
  getBookingContext: (key) => {
    const context = bookingContexts.get(key);
    if (!context) return null;
    
    // Check if expired
    if (context.expiresAt < Date.now()) {
      bookingContexts.delete(key);
      return null;
    }
    
    return context;
  },
  
  deleteBookingContext: (key) => {
    bookingContexts.delete(key);
  }
};