// utils/timeHelper.js
// utils/timeHelper.js
export const calculateCheckTimes = (date, timing) => {
  const [start, end] = timing.toLowerCase().split("-");

  const parseTime = (timeStr) => {
    let hour = parseInt(timeStr);
    const isPM = timeStr.includes("pm");
    const isAM = timeStr.includes("am");

    if (isPM && hour !== 12) hour += 12;
    if (isAM && hour === 12) hour = 0;

    return hour;
  };

  const startHour = parseTime(start);
  const endHour = parseTime(end);

  const checkIn = new Date(date);
  checkIn.setHours(startHour, 0, 0, 0);

  const checkOut = new Date(date);
  checkOut.setHours(endHour, 0, 0, 0);

  // overnight safety (example: 7pm-6am)
  if (checkOut <= checkIn) {
    checkOut.setDate(checkOut.getDate() + 1);
  }

  return { checkIn, checkOut };
};
