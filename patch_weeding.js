const fs = require('fs');
const content = fs.readFileSync('src/pages/reserva/DetailsPage.tsx', 'utf8');

const regex = /\{\/\* Photos Area for this Zone \*\/\}\s*<div className="mb-4">[\s\S]*?(?=<div className="flex flex-row overflow-x-auto gap-3 pb-2 snap-x items-center scrollbar-hide min-h-\[110px\]">)[\s\S]*?{!isZoneAnalyzing && allPhotos\.length < 5 && \([\s\S]*?<\/div>\s*\)\}\s*<\/div>\s*\)\}\s*<\/div>/g;

// Instead of regex, let's use a robust string replacement function for each service.
