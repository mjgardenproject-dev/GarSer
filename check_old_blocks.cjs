const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const oldShrubStart = "{/* --- Shrub Analysis Results (Poda de plantas y arbustos) --- */}";
const oldPalmStart = "{/* --- Palm Analysis Results (Poda de palmeras) --- */}";
const targetEnd = "{/* --- Result Lists by Service --- */}"; // usually comes after or there is something else

const shrubIndex = content.indexOf(oldShrubStart);
const palmIndex = content.indexOf(oldPalmStart);

// Let's find the end by looking for the next major section, maybe "Phytosanitary Results" or the bottom navigation.
const endOfResultsIndex = content.indexOf("<div className=\"fixed bottom-0 left-0 right-0");

if (shrubIndex !== -1 && endOfResultsIndex !== -1) {
    // wait, what if there's other stuff between?
    // Let's just remove from oldShrubStart up to endOfResultsIndex, because all old results blocks are inside here!
    // But Phytosanitary uses a different UI? Wait.
    console.log('Shrub found at', shrubIndex, 'End at', endOfResultsIndex);
} else {
    console.error('Not found');
}
