const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const oldShrubStart = "{/* --- Shrub Analysis Results (Poda de plantas y arbustos) --- */}";
const endBlockMarker = "{/* --- Waste Removal Switch --- */}";

if (content.includes(oldShrubStart) && content.includes(endBlockMarker)) {
    const s = content.indexOf(oldShrubStart);
    const e = content.indexOf(endBlockMarker);
    content = content.substring(0, s) + content.substring(e);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Old Shrub and Palm global blocks removed.');
} else {
    console.error('Markers not found');
}
