const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const target = "const [treeAnalyzingZoneIds, setTreeAnalyzingZoneIds] = useState<Set<string>>(new Set());";

if (content.includes(target)) {
    const replacement = target + `
  const [palmUploads, setPalmUploads] = useState<Record<string, Set<number>>>({});
  const [palmAnalyzingZoneIds, setPalmAnalyzingZoneIds] = useState<Set<string>>(new Set());
`;
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content, 'utf8');
    console.log('States added');
} else {
    console.error('Target not found');
}
