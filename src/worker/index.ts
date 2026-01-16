import dotenv from 'dotenv';
import path from 'path';

// Load .env BEFORE importing other modules
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

console.log('AlumniReach Worker');
console.log('==================');
console.log('');
console.log('Note: The worker is no longer needed for the new search-based flow.');
console.log('Search and email enrichment now happen synchronously when you search.');
console.log('');
console.log('You can safely close this process.');
console.log('The main app (npm run dev) handles everything.');
