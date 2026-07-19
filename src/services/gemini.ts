/**
 * Service pour interagir avec l'API REST de Gemini.
 * Utilise des appels fetch natifs pour la simplicité et la flexibilité.
 */

// Nettoie le code généré par Gemini pour enlever les blocs de markdown (ex: ```typescript ... ```)
// Exemple : nettoyerCodeGenere("```javascript\nconst a = 1;\n```") -> "const a = 1;"
const nettoyerCodeGenere = (texte: string): string => {
  let code = texte.trim();
  
  // Si le code commence par ```, on retire la ligne d'ouverture et de fermeture
  if (code.startsWith('```')) {
    const lignes = code.split('\n');
    if (lignes[0].startsWith('```')) {
      lignes.shift(); // Retire la ligne contenant par exemple '```typescript'
    }
    if (lignes[lignes.length - 1] === '```') {
      lignes.pop(); // Retire la ligne de fin '```'
    }
    code = lignes.join('\n');
  }
  
  return code.trim();
};

/**
 * Envoie le fichier d'origine et la consigne à Gemini pour modifier le code
 * 
 * Exemple :
 * const codeModifie = await modifierCodeAvecGemini("cle_api", "console.log('hi');", "Ajoute un log de fin", "index.js");
 */
export async function modifierCodeAvecGemini(
  apiKey: string,
  codeOriginal: string,
  consigne: string,
  nomFichier: string
): Promise<string> {
  console.log('🚀 [Gemini] Envoi de la demande de modification pour:', nomFichier);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // Prompt élaboré pour contraindre l'IA à renvoyer UNIQUEMENT le code modifié sans explication
    const promptSystem = `Tu es un expert en programmation. On te fournit le code source d'un fichier nommé "${nomFichier}" et une consigne de modification.
Renvoie le code source COMPLET de ce fichier contenant la modification demandée.

RÈGLES CRITIQUES:
1. Ne donne AUCUNE explication, aucun commentaire en dehors du code.
2. Ne mets aucun bloc markdown comme \`\`\`typescript ou \`\`\` au début ou à la fin. Renvoie uniquement le code source brut.
3. Conserve la logique et le style du fichier original, n'altère pas le code non concerné.
4. Les commentaires éventuels décrivant tes ajouts dans le code doivent être rédigés en français.`;

    const instructionsEtCode = `Voici le code d'origine du fichier "${nomFichier}":
---
${codeOriginal}
---

Consigne de modification:
${consigne}`;

    const corpsRequete = {
      contents: [
        {
          parts: [
            { text: promptSystem },
            { text: instructionsEtCode }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1 // Température basse pour être plus prédictif et précis sur le code
      }
    };

    const reponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(corpsRequete)
    });

    if (!reponse.ok) {
      const erreurText = await reponse.text();
      console.log('❌ [Gemini] Erreur de l\'API Gemini:', reponse.status, erreurText);
      throw new Error(`Erreur API Gemini (${reponse.status}): ${erreurText}`);
    }

    const donnees = await reponse.json();
    const texteBrut = donnees.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!texteBrut) {
      console.log('❌ [Gemini] Réponse vide reçue de l\'API');
      throw new Error('Réponse vide de la part de Gemini');
    }

    const codeNettoye = nettoyerCodeGenere(texteBrut);
    console.log('✅ [Gemini] Code modifié reçu et nettoyé avec succès');
    return codeNettoye;
  } catch (erreur) {
    console.error('❌ [Gemini] Échec de l\'appel à Gemini:', erreur);
    throw erreur;
  }
}
