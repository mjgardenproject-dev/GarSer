const fs = require('fs');

const indexTsPath = './supabase/functions/ai-pricing-estimator/index.ts';
const newPromptsTsPath = './supabase/functions/ai-pricing-estimator/new_prompts.ts';

const indexTs = fs.readFileSync(indexTsPath, 'utf8');
const newPromptsTs = fs.readFileSync(newPromptsTsPath, 'utf8');

const regex = /const PROMPTS: Record<string, string> = \{[\s\S]*?\};\n/;
const updatedIndexTs = indexTs.replace(regex, newPromptsTs + '\n');

fs.writeFileSync(indexTsPath, updatedIndexTs, 'utf8');
console.log('Prompts replaced successfully.');
