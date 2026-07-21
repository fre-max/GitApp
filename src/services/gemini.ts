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
  } catch (erreurFirst) {
    // Si le parsing échoue à cause de caractères de contrôle (ex: saut de ligne brut dans une chaîne),
    // on assainit la chaîne avant la deuxième tentative
    try {
      const brutAssaini = brut.replace(/[\u0000-\u001F]+/g, (match) => {
        if (match === '\n') return '\\n';
        if (match === '\r') return '\\r';
        if (match === '\t') return '\\t';
        return '';
      });
      const tableau = JSON.parse(brutAssaini);
      if (!Array.isArray(tableau)) throw new Error("Pas un tableau");
      console.log("✅ [Gemini] Parsing JSON réussi après assainissement des caractères de contrôle.");
      return tableau;
    } catch (erreurSecond) {
      console.error("❌ [Gemini] Échec définitif du parsing JSON. Brut :", brut, erreurFirst);
      throw new Error(`Impossible de décoder la réponse structurée de l'IA : ${erreurFirst}`);
    }
  }
};

// Modèles Gemini supportés (du plus récent/intelligent au modèle de secours)
export const LISTE_MODELES_GEMINI = [
  { id: 'gemini-3.5-flash', nom: 'Gemini 3.5 Flash (Rapide & Ultra Intelligent)' },
  { id: 'gemini-3.1-pro-preview', nom: 'Gemini 3.1 Pro (Code Complexe & Raisonnement)' },
  { id: 'gemini-3.1-flash-lite', nom: 'Gemini 3.1 Flash-Lite (Super Léger)' },
  { id: 'gemini-3-flash-preview', nom: 'Gemini 3.0 Flash (Haute Performance)' },
  { id: 'gemini-2.5-flash', nom: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', nom: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.0-flash', nom: 'Gemini 2.0 Flash' }
];

/**
 * Appelle l'API Gemini avec un mécanisme de fallback automatique en cascade.
 * Place le modèle préféré de l'utilisateur en premier.
 * Si un modèle retourne 404 ou 429, passe automatiquement au modèle suivant.
 */
async function appelerGeminiAvecFallback(
  apiKey: string,
  corpsRequete: any,
  modelePrefere?: string
): Promise<any> {
  let derniereErreur = '';

  const listeModeles = LISTE_MODELES_GEMINI.map(m => m.id);
  if (modelePrefere && listeModeles.includes(modelePrefere)) {
    const idx = listeModeles.indexOf(modelePrefere);
    listeModeles.splice(idx, 1);
    listeModeles.unshift(modelePrefere);
  }

  for (const modele of listeModeles) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${apiKey}`;
    try {
      console.log(`📡 [Gemini] Tentative avec le modèle: ${modele}...`);
      const reponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpsRequete)
      });

      if (reponse.ok) {
        console.log(`✅ [Gemini] Succès avec le modèle ${modele} !`);
        return await reponse.json();
      }

      const txtErreur = await reponse.text();
      console.log(`⚠️ [Gemini] Le modèle ${modele} a retourné (${reponse.status}):`, txtErreur);
      derniereErreur = `(${reponse.status}): ${txtErreur}`;

      if (reponse.status === 404 || reponse.status === 429) {
        continue;
      }

      throw new Error(`Erreur API Gemini (${reponse.status}): ${txtErreur}`);
    } catch (erreur: any) {
      if (erreur.message?.includes('404') || erreur.message?.includes('429')) {
        continue;
      }
      throw erreur;
    }
  }

  throw new Error(`Aucun modèle Gemini n'a pu répondre. ${derniereErreur}`);
}

export interface ModificationFichier {
  action: 'MODIFY' | 'CREATE';
  path: string;
  content: string;
}

/**
 * Étape 1 du mode Agent Autonome.
 * Demande à Gemini de lire l'arborescence du projet et la consigne utilisateur,
 * puis de retourner UNIQUEMENT la liste des chemins de fichiers dont il a besoin
 * pour répondre à la demande.
 */
export async function choisirFichiersNecessaires(
  apiKey: string,
  arborescence: string[],
  consigne: string,
  modelePrefere?: string
): Promise<string[]> {
  console.log('🔍 [Gemini Agent] Analyse de l\'arborescence pour sélectionner les fichiers...');

  // Prompt demandant uniquement une liste de fichiers pertinents en JSON
  const promptSelection = `Tu es un expert en analyse de code. On te donne l'arborescence complète d'un projet et une consigne de modification.

Ton rôle : identifier UNIQUEMENT les fichiers nécessaires pour réaliser la consigne.
Réponds avec un tableau JSON de chemins de fichiers, et rien d'autre.

Règles :
1. Inclure les fichiers à MODIFIER directement.
2. Inclure les fichiers de CONTEXTE (types, interfaces, utilitaires) si leur lecture est indispensable pour comprendre les modifications.
3. Limiter à 10 fichiers maximum pour rester efficace.
4. Ne renvoyer QUE le tableau JSON. Pas d'explication, pas de markdown.

Format de réponse attendu :
["chemin/fichier1.tsx", "chemin/fichier2.ts"]

Arborescence du projet :
${arborescence.map(c => `- ${c}`).join('\n')}

Consigne de l'utilisateur :
${consigne}`;

  const corpsRequete = {
    contents: [{ parts: [{ text: promptSelection }] }],
    generationConfig: {
      temperature: 0.0,
      responseMimeType: 'application/json'
    }
  };

  const donnees = await appelerGeminiAvecFallback(apiKey, corpsRequete, modelePrefere);
  const texteBrut = donnees.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!texteBrut) {
    throw new Error('Gemini n\'a pas retourné de liste de fichiers.');
  }

  // On réutilise extraireJSON pour parser le tableau de chemins retourné
  const listeFichiers = extraireJSON(texteBrut) as string[];

  // Vérification de sécurité : ne garder que les chemins qui existent bien dans l'arborescence
  const fichiersValides = listeFichiers.filter(chemin => arborescence.includes(chemin));

  console.log(`✅ [Gemini Agent] ${fichiersValides.length} fichier(s) sélectionné(s) automatiquement :`, fichiersValides);
  return fichiersValides;
}

/**
 * Envoie le contexte du projet et demande à Gemini de retourner les modifications de code
 * sous forme d'un tableau JSON structuré.
 * 
 * Exemple :
 * const modifs = await modifierCodeAvecGemini("api_key", [...], {path: "App.tsx", content: "..."}, [...], "consigne");
 */
/**
 * Étape 2 du mode Agent Autonome.
 * Reçoit les fichiers déjà téléchargés et la consigne, demande à Gemini
 * de retourner les modifications sous forme de tableau JSON structuré.
 *
 * Note : plus de distinction cible/contexte — Gemini a lui-même choisi les fichiers
 * via choisirFichiersNecessaires() et décide ce qu'il modifie.
 *
 * Exemple :
 * const modifs = await modifierCodeAvecGemini(apiKey, arbre, fichiers, "Ajoute la validation d'email");
 */
export async function modifierCodeAvecGemini(
  apiKey: string,
  arborescence: string[],
  fichiersCharges: Array<{ path: string; content: string }>,
  consigne: string,
  modelePrefere?: string
): Promise<ModificationFichier[]> {
  console.log(`🚀 [Gemini] Génération des modifications pour ${fichiersCharges.length} fichier(s) chargé(s)`);
  try {
    // Prompt système forçant le retour d'un tableau JSON structuré précis
    const promptSystem = `Tu es un assistant de développement logiciel expert piloté par API.
On te fournit la structure complète d'un projet et les fichiers que tu as toi-même choisis de lire.

Tu dois répondre UNIQUEMENT sous la forme d'un tableau JSON valide, sans aucune explication ou commentaire en dehors du JSON.
Chaque élément du tableau doit décrire une action sur un fichier.

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
3. Pour chaque fichier modifié ou créé, fournis toujours le code source COMPLET dans le champ "content". Pas de troncatures.
4. Tu n'es pas limité aux fichiers fournis — tu peux créer de nouveaux fichiers si la consigne l'exige.
5. Les commentaires dans le code généré doivent être en français.`;

    const texteArborescence = arborescence.map(chemin => `- ${chemin}`).join('\n');

    // Tous les fichiers chargés (Gemini les a choisis lui-même — il sait lesquels modifier)
    const texteFichiers = fichiersCharges
      .map(
        f => `FICHIER : "${f.path}"
---
${f.content}
---`
      )
      .join('\n\n');

    const instructionsEtCode = `Voici l'arborescence complète du projet :
${texteArborescence}

Voici les fichiers que tu as choisis de lire pour répondre à la consigne :
${texteFichiers}

Consigne à appliquer :
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

    const donnees = await appelerGeminiAvecFallback(apiKey, corpsRequete, modelePrefere);
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

/**
 * Génère l'ensemble des fichiers de départ pour un tout nouveau projet Expo / React Native
 * à partir de la description fournie par l'utilisateur.
 *
 * Exemple :
 * const fichiers = await genererNouveauProjetComplet("api_key", "Application de Todo List", "TodoApp");
 */
export async function genererNouveauProjetComplet(
  apiKey: string,
  descriptionProjet: string,
  nomProjet: string,
  modelePrefere?: string
): Promise<ModificationFichier[]> {
  console.log(`🚀 [Gemini] Génération du projet complet "${nomProjet}"...`);

  const promptSystem = `Tu me génères un projet complet Expo / React Native fonctionnel pour une application mobile.

Tu dois répondre UNIQUEMENT sous la forme d'un tableau JSON strict, contenant les fichiers à créer.
Chaque élément doit être :
{
  "action": "CREATE",
  "path": "chemin/du/fichier",
  "content": "... code complet du fichier ..."
}

Fichiers OBLIGATOIRES à créer :
1. "App.tsx" : Composant React Native complet avec UI soignée et fonctionnelle pour le projet.
2. "package.json" : Configuration Node.js complète pour Expo avec dépendances nécessaires.
3. "app.json" : Configuration Expo (name: "${nomProjet}", slug: "${nomProjet.toLowerCase()}").
4. "README.md" : Documentation d'installation et d'utilisation.
5. ".gitignore" : Exclusions node_modules, .expo, dist, etc.
6. ".github/workflows/build.yml" : Workflow GitHub Actions pour construire/tester le projet.

Nom du projet : ${nomProjet}
Description fonctionnelle souhaitée par l'utilisateur :
${descriptionProjet}`;

  const corpsRequete = {
    contents: [{ parts: [{ text: promptSystem }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  const donnees = await appelerGeminiAvecFallback(apiKey, corpsRequete, modelePrefere);
  const texteBrut = donnees.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texteBrut) throw new Error('Aucune réponse reçue de Gemini.');

  return extraireJSON(texteBrut) as ModificationFichier[];
}


