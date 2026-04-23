// services/agent-web/src/components/RouletteHelpers.js

// Tableau des numéros rouges pour la coloration
export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

// Helper pour calculer le numéro à une coordonnée (col, row) donnée
// Notre grille visuelle (1-36) est de 12 colonnes par 3 lignes (lignes: 2=bas, 1=milieu, 0=haut)
export const getNumberAtCoord = (col, row) => {
  if (col < 0 || col > 11 || row < 0 || row > 2) return null;
  // Les colonnes sont de 3 numéros. Exemple Col 0: 3(0), 2(1), 1(2)
  // On inverse row pour que 0 soit le haut et 2 le bas
  // Numéro = (3 - row) + col * 3
  return (3 - row) + col * 3;
};

// Helper pour calculer les coordonnées (col, row) d'un numéro donné (1-36)
export const getCoordOfNumber = (num) => {
  if (num < 1 || num > 36) return null;
  const col = Math.floor((num - 1) / 3);
  const row = 2 - ((num - 1) % 3);
  return { col, row };
};
