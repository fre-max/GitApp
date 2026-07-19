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
 * Envoie le fichier cible, les fichiers de contexte et la consigne à Gemini pour modifier le code
 * 
 * Exemple :
 * const codeModifie = await modifierCodeAvecGemini(
 *   "cle_api",
 *   ["App.tsx", "package.json"],
 *   { path: "App.tsx", content: "..." },
 *   [{ path: "package.json", content: "..." }],
 *   "Ajoute un composant"
 * );
 */
export async function modifierCodeAvecGemini(
  apiKey: string,
  arborescence: string[],
  fichierCible: { path: string; content: string },
  fichiersContexte: Array<{ path: string; content: string }>,
  consigne: string
): Promise<string> {
  console.log('🚀 [Gemini] Envoi de la demande de modification multi-fichiers pour:', fichierCible.path);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // Prompt élaboré pour contraindre l'IA à renvoyer UNIQUEMENT le code modifié du fichier cible
    const promptSystem = `Tu es un assistant de développement logiciel expert. On te fournit l'arborescence du projet, des fichiers en lecture seule pour contexte, et le fichier cible à modifier.
Tu dois modifier le fichier cible demandé en tenant compte de ces informations et de la consigne.

RÈGLES CRITIQUES:
1. Renvoie UNIQUEMENT le code source COMPLET du fichier cible modifié.
2. Ne donne AUCUNE explication, aucun commentaire explicatif en dehors du code.
3. Ne mets aucun bloc markdown comme \`\`\`typescript ou \`\`\` au début ou à la fin. Renvoie uniquement le code source brut.
4. Conserve la logique et le style du fichier original, n'altère pas le code non concerné.
5. Les commentaires éventuels décrivant tes modifications dans le code doivent être rédigés en français.`;

    // Formatage de l'arborescence du projet
    const texteArborescence = arborescence.map(chemin => `- ${chemin}`).join('\n');

    // Formatage des fichiers de contexte en lecture seule
    const texteContexte = fichiersContexte
      .map(
        f => `FICHIER CONTEXTE [LECTURE SEULE] : "${f.path}"
---
${f.content}
---`
      )
      .join('\n\n');

    // Formatage du fichier cible à modifier
    const texteCible = `FICHIER CIBLE À MODIFIER : "${fichierCible.path}"
---
${fichierCible.content}
---`;

    const instructionsEtCode = `Voici l'arborescence du projet :
${texteArborescence}

${fichiersContexte.length > 0 ? `Voici les fichiers de contexte pour information :\n${texteContexte}\n` : ''}

Voici le fichier à modifier :
${texteCible}

Consigne de modification à appliquer UNIQUEMENT sur le fichier cible "${fichierCible.path}" :
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
        temperature: 0.1 // Température basse pour la précision du code
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

