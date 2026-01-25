// Test script to verify the booking flow
console.log('Testing gardener booking flow...');

// Test the booking flow with a mock gardener ID
const testGardenerId = 'test-gardener-123';
const bookingUrl = `http://localhost:5173/reserva?gardenerId=${testGardenerId}`;

console.log('Booking URL:', bookingUrl);

// Test the public profile URL
const profileUrl = `http://localhost:5173/jardinero/${testGardenerId}`;
console.log('Profile URL:', profileUrl);

// Open the booking page
window.open(bookingUrl, '_blank');

console.log('Test completed. Check the opened page for gardener information display.');