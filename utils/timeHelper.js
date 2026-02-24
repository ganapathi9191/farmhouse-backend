// utils/timeHelper.js
export const calculateCheckTimes = (dateString, timing) => {
  if (!dateString || !timing) {
    throw new Error('Date and timing are required');
  }

  // Parse the date
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format');
  }

  // Parse timing (e.g., "09:00 AM - 12:00 PM")
  const [startTimeStr, endTimeStr] = timing.split('-').map(t => t.trim());
  
  if (!startTimeStr || !endTimeStr) {
    throw new Error('Invalid timing format. Use "HH:MM AM/PM - HH:MM AM/PM"');
  }

  // Function to parse time string
  const parseTime = (timeStr) => {
    const [time, period] = timeStr.split(/(?=[AP]M)/i);
    const [hours, minutes] = time.split(':').map(Number);
    
    let hour = hours;
    if (period && period.toLowerCase() === 'pm' && hours < 12) {
      hour = hours + 12;
    } else if (period && period.toLowerCase() === 'am' && hours === 12) {
      hour = 0;
    }
    
    return { hour, minutes: minutes || 0 };
  };

  const start = parseTime(startTimeStr);
  const end = parseTime(endTimeStr);

  // Create check-in and check-out dates
  const checkIn = new Date(date);
  checkIn.setHours(start.hour, start.minutes, 0, 0);

  const checkOut = new Date(date);
  checkOut.setHours(end.hour, end.minutes, 0, 0);

  // If check-out is before check-in (overnight), add one day to check-out
  if (checkOut <= checkIn) {
    checkOut.setDate(checkOut.getDate() + 1);
  }

  return { checkIn, checkOut };
};