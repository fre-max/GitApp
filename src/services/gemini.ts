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

// Extrait et parse un tableau JSON structuré depuis la réponse texte brute de Gemini
// Gère les blocs markdown ```json ... ``` et le texte parasite autour
// Exemple : extraireJSON("Voici le JSON: ```json\n[{\"path\": \"a.txt\"}]\n```") -> [{"path": "a.txt"}]
const extraireJSON = (texte: string): any[] => {
  let brut = texte.trim();
  
  // Retire les balises markdown de bloc de code
  if (brut.startsWith('```')) {
    const lignes = brut.split('\n');
    if (lignes[0].startsWith('```')) {
      lignes.shift();
    }
    if (lignes[lignes.length - 1] === '```') {
      lignes.pop();
    }
    brut = lignes.join('\n').trim();
  }
  
  // Tente d'isoler la chaîne JSON délimitée par les crochets du tableau
  const premierCrochet = brut.indexOf('[');
  const dernierCrochet = brut.lastIndexOf(']');
  
  if (premierCrochet !== -1 && dernierCrochet !== -1 && dernierCrochet > premierCrochet) {
    brut = brut.substring(premierCrochet, dernierCrochet + 1);
  }
  
  try {
    const tableau = JSON.parse(brut);
    if (!Array.isArray(tableau)) {
      throw new Error("La réponse JSON n'est pas un tableau.");
    }
    return tableau;
  } catch (erreur) {
    console.error("❌ [Gemini] Échec du parsing JSON. Brut :", brut, erreur);
    throw new Error(`Impossible de décoder la réponse structurée de l'IA : ${erreur}`);
  }
};

export interface ModificationFichier {
  action: 'MODIFY' | 'CREATE';
  path: string;
  content: string;
}

/**
 * Envoie le contexte du projet et demande à Gemini de retourner les modifications de code
 * sous forme d'un tableau JSON structuré.
 * 
 * Exemple :
 * const modifs = await modifierCodeAvecGemini("api_key", [...], {path: "App.tsx", content: "..."}, [...], "consigne");
 */
export async function modifierCodeAvecGemini(
  apiKey: string,
  arborescence: string[],
  fichiersCibles: Array<{ path: string; content: string }>,
  fichiersContexte: Array<{ path: string; content: string }>,
  consigne: string
): Promise<ModificationFichier[]> {
  console.log(`🚀 [Gemini] Demande de modification multi-fichiers pour ${fichiersCibles.length} fichiers cibles`);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // Prompt système forçant le retour d'un tableau JSON structuré précis
    const promptSystem = `Tu es un assistant de développement logiciel expert piloté par API.
On te fournit la structure d'un projet, des fichiers en lecture seule de contexte, et les fichiers cibles à modifier ou à créer.

Tu dois répondre UNIQUEMENT sous la forme d'un tableau JSON valide, sans aucune explication ou commentaire en dehors du JSON.
Chaque élément du tableau doit être un objet décrivant une action sur un fichier.

Format de réponse attendu (JSON Strict) :
[
  {
    "action": "MODIFY",
    "path": "chemin/du/fichier/cible.tsx",
    "content": "... code source complet modifié ..."
  },
  {
    "action": "CREATE",
    "path": "chemin/du/nouveau/fichier.tsx",
    "content": "... code source complet du nouveau fichier ..."
  }
]

RÈGLES CRITIQUES :
1. Renvoie UNIQUEMENT le tableau JSON. Pas de blabla, pas de politesses.
2. Ne mets aucun bloc markdown comme \`\`\`json ou \`\`\` au début ou à la fin.
3. Pour chaque fichier modifié ou créé, fournis toujours le code source COMPLET dans le champ "content". Pas de troncatures ou de commentaires type "// Reste du code inchangé".
4. Ne modifie ou ne crée que des fichiers qui sont listés dans les fichiers cibles ou qui sont nécessaires à la consigne.
5. Les commentaires rédigés dans le code source généré doivent être en français.`;

    const texteArborescence = arborescence.map(chemin => `- ${chemin}`).join('\n');

    const texteContexte = fichiersContexte
      .map(
        f => `FICHIER CONTEXTE [LECTURE SEULE] : "${f.path}"
---
${f.content}
---`
      )
      .join('\n\n');

    const texteCibles = fichiersCibles
      .map(
        f => `FICHIER CIBLE (À MODIFIER OU CRÉER) : "${f.path}"
---
${f.content}
---`
      )
      .join('\n\n');

    const instructionsEtCode = `Voici l'arborescence du projet :
${texteArborescence}

${fichiersContexte.length > 0 ? `Voici les fichiers de contexte pour information :\n${texteContexte}\n` : ''}

Voici les fichiers cibles sur lesquels les modifications doivent être portées ou créées :
${texteCibles}

Consigne de modification à appliquer :
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
        temperature: 0.1, // Basse température pour le respect strict du JSON
        responseMimeType: "application/json" // Force le modèle à sortir du JSON
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

    const modifications = extraireJSON(texteBrut);
    console.log(`✅ [Gemini] Réception réussie de ${modifications.length} modification(s) de fichier`);
    return modifications as ModificationFichier[];
  } catch (erreur) {
    console.error('❌ [Gemini] Échec lors de la génération multi-fichiers:', erreur);
    throw erreur;
  }
}


