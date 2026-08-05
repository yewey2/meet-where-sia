function normaliseName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const codesByStation = new Map();

function addCode(name, code) {
  const key = normaliseName(name);
  const codes = codesByStation.get(key) || [];
  if (!codes.includes(code)) codes.push(code);
  codesByStation.set(key, codes);
}

function addNumberedLine(prefix, stations) {
  stations.forEach((name, index) => {
    if (name) addCode(name, `${prefix}${index + 1}`);
  });
}

addNumberedLine('NS', [
  'Jurong East', 'Bukit Batok', 'Bukit Gombak', 'Choa Chu Kang',
  'Yew Tee', null, 'Kranji', 'Marsiling', 'Woodlands', 'Admiralty',
  'Sembawang', 'Canberra', 'Yishun', 'Khatib', 'Yio Chu Kang',
  'Ang Mo Kio', 'Bishan', 'Braddell', 'Toa Payoh', 'Novena', 'Newton',
  'Orchard', 'Somerset', 'Dhoby Ghaut', 'City Hall', 'Raffles Place',
  'Marina Bay', 'Marina South Pier',
]);

addNumberedLine('EW', [
  'Pasir Ris', 'Tampines', 'Simei', 'Tanah Merah', 'Bedok', 'Kembangan',
  'Eunos', 'Paya Lebar', 'Aljunied', 'Kallang', 'Lavender', 'Bugis',
  'City Hall', 'Raffles Place', 'Tanjong Pagar', 'Outram Park',
  'Tiong Bahru', 'Redhill', 'Queenstown', 'Commonwealth', 'Buona Vista',
  'Dover', 'Clementi', 'Jurong East', 'Chinese Garden', 'Lakeside',
  'Boon Lay', 'Pioneer', 'Joo Koon', 'Gul Circle', 'Tuas Crescent',
  'Tuas West Road', 'Tuas Link',
]);
addCode('Tanah Merah', 'CG');
addCode('Expo', 'CG1');
addCode('Changi Airport', 'CG2');

addNumberedLine('NE', [
  'HarbourFront', null, 'Outram Park', 'Chinatown', 'Clarke Quay',
  'Dhoby Ghaut', 'Little India', 'Farrer Park', 'Boon Keng',
  'Potong Pasir', 'Woodleigh', 'Serangoon', 'Kovan', 'Hougang',
  'Buangkok', 'Sengkang', 'Punggol', 'Punggol Coast',
]);

addNumberedLine('CC', [
  'Dhoby Ghaut', 'Bras Basah', 'Esplanade', 'Promenade', 'Nicoll Highway',
  'Stadium', 'Mountbatten', 'Dakota', 'Paya Lebar', 'MacPherson',
  'Tai Seng', 'Bartley', 'Serangoon', 'Lorong Chuan', 'Bishan',
  'Marymount', 'Caldecott', null, 'Botanic Gardens', 'Farrer Road',
  'Holland Village', 'Buona Vista', 'one-north', 'Kent Ridge',
  'Haw Par Villa', 'Pasir Panjang', 'Labrador Park', 'Telok Blangah',
  'HarbourFront', 'Keppel', 'Cantonment', 'Prince Edward Road',
  'Marina Bay', 'Bayfront',
]);

addNumberedLine('DT', [
  'Bukit Panjang', 'Cashew', 'Hillview', 'Hume', 'Beauty World',
  'King Albert Park', 'Sixth Avenue', 'Tan Kah Kee', 'Botanic Gardens',
  'Stevens', 'Newton', 'Little India', 'Rochor', 'Bugis', 'Promenade',
  'Bayfront', 'Downtown', 'Telok Ayer', 'Chinatown', 'Fort Canning',
  'Bencoolen', 'Jalan Besar', 'Bendemeer', 'Geylang Bahru', 'Mattar',
  'MacPherson', 'Ubi', 'Kaki Bukit', 'Bedok North', 'Bedok Reservoir',
  'Tampines West', 'Tampines', 'Tampines East', 'Upper Changi', 'Expo',
]);

addNumberedLine('TE', [
  'Woodlands North', 'Woodlands', 'Woodlands South', 'Springleaf',
  'Lentor', 'Mayflower', 'Bright Hill', 'Upper Thomson', 'Caldecott', null,
  'Stevens', 'Napier', 'Orchard Boulevard', 'Orchard', 'Great World',
  'Havelock', 'Outram Park', 'Maxwell', 'Shenton Way', 'Marina Bay', null,
  'Gardens by the Bay', 'Tanjong Rhu', 'Katong Park', 'Tanjong Katong',
  'Marine Parade', 'Marine Terrace', 'Siglap', 'Bayshore',
]);

addNumberedLine('BP', [
  'Choa Chu Kang', 'South View', 'Keat Hong', 'Teck Whye', 'Phoenix',
  'Bukit Panjang', 'Petir', 'Pending', 'Bangkit', 'Fajar', 'Segar',
  'Jelapang', 'Senja',
]);

addCode('Sengkang', 'STC');
addNumberedLine('SE', [
  'Compassvale', 'Rumbia', 'Bakau', 'Kangkar', 'Ranggung',
]);
addNumberedLine('SW', [
  'Cheng Lim', 'Farmway', 'Kupang', 'Thanggam', 'Fernvale', 'Layar',
  'Tongkang', 'Renjong',
]);

addCode('Punggol', 'PTC');
addNumberedLine('PE', [
  'Cove', 'Meridian', 'Coral Edge', 'Riviera', 'Kadaloor', 'Oasis', 'Damai',
]);
addNumberedLine('PW', [
  'Sam Kee', 'Teck Lee', 'Punggol Point', 'Samudera', 'Nibong', 'Sumang',
  'Soo Teck',
]);

export function stationCodesForName(name) {
  return [...(codesByStation.get(normaliseName(name)) || [])];
}
