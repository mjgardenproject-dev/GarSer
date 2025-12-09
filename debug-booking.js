// Debug script to test the booking flow
console.log('=== GARDENER BOOKING FLOW DEBUG ===');

// Test URL parameters
const urlParams = new URLSearchParams(window.location.search);
const gardenerId = urlParams.get('gardenerId');
console.log('Gardener ID from URL:', gardenerId);

// Test sessionStorage
const sessionGardenerId = sessionStorage.getItem('restrictedGardenerId');
console.log('Gardener ID from sessionStorage:', sessionGardenerId);

// Test location state (if available)
console.log('Location state:', window.history.state);

// Check if the booking page is accessible
console.log('Current pathname:', window.location.pathname);

// Test if the page loads correctly
window.addEventListener('load', () => {
    console.log('Page loaded successfully');
    
    // Check for gardener info banner after a delay
    setTimeout(() => {
        const banner = document.querySelector('.bg-blue-50.border-blue-200');
        console.log('Gardener info banner found:', banner);
        
        if (banner) {
            console.log('Banner text:', banner.textContent);
        } else {
            console.log('No gardener info banner found');
        }
    }, 2000);
});

console.log('=== DEBUG SCRIPT COMPLETED ===');