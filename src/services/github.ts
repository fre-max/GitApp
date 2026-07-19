/**
 * Service pour interagir avec l'API REST de GitHub.
 * Utilise des appels fetch natifs pour respecter la simplicité.
 */

// Encode une chaîne de caractères en Base64 compatible UTF-8 pour React Native
// Exemple : encodeBase64("Bonjour l'IA") -> "Qm9uam91ciBsJ0lB"
const encodeBase64 = (str: string): string => {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
      return String.fromCharCode(parseInt(p1, 16));
    })
  );
};

// Décode une chaîne Base64 en texte UTF-8 lisible pour React Native
// Exemple : decodeBase64("Qm9uam91ciBsJ0lB") -> "Bonjour l'IA"
const decodeBase64 = (str: string): string => {
  return decodeURIComponent(
    atob(str.replace(/\s/g, ''))
      .split('')
      .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
};

/**
 * Récupère le contenu et le SHA d'un fichier sur un dépôt GitHub
 * 
 * Exemple :
 * const fichier = await recupererContenuFichier("token...", "octocat", "Hello-World", "README.md", "main");
 * console.log(fichier.content); // "Texte du fichier..."
 */
export async function recupererContenuFichier(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<{ content: string; sha: string }> {
  console.log('🚀 [GitHub] Début de récupération du fichier:', path);
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    const reponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      }
    });

    if (!reponse.ok) {
      const erreurText = await reponse.text();
      console.log('❌ [GitHub] Erreur de récupération:', reponse.status, erreurText);
      throw new Error(`Erreur GitHub (${reponse.status}): ${erreurText}`);
    }

    const donnees = await reponse.json();
    const texteDecode = decodeBase64(donnees.content);

    console.log('✅ [GitHub] Fichier récupéré avec succès');
    return {
      content: texteDecode,
      sha: donnees.sha
    };
  } catch (erreur) {
    console.error('❌ [GitHub] Échec de la récupération du fichier:', erreur);
    throw erreur;
  }
}

/**
 * Crée une nouvelle branche à partir d'une branche existante (ex: main)
 * 
 * Exemple :
 * const nouvelleBranche = await creerNouvelleBranche("token...", "octocat", "Hello-World", "main", "feature/ma-branche");
 */
export async function creerNouvelleBranche(
  token: string,
  owner: string,
  repo: string,
  brancheSource: string,
  nomNouvelleBranche: string
): Promise<string> {
  console.log(`🚀 [GitHub] Création de la branche ${nomNouvelleBranche} à partir de ${brancheSource}`);
  try {
    // 1. Récupérer le SHA du dernier commit de la branche source
    const urlSource = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${brancheSource}`;
    const reponseSource = await fetch(urlSource, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      }
    });

    if (!reponseSource.ok) {
      const erreurText = await reponseSource.text();
      console.log('❌ [GitHub] Impossible de lire la branche source:', reponseSource.status, erreurText);
      throw new Error(`Branche source introuvable: ${erreurText}`);
    }

    const donneesSource = await reponseSource.json();
    const shaDernierCommit = donneesSource.object.sha;
    console.log('📡 [GitHub] SHA du dernier commit récupéré:', shaDernierCommit);

    // 2. Créer la nouvelle branche en pointant sur ce SHA
    const urlCreation = `https://api.github.com/repos/${owner}/${repo}/git/refs`;
    const reponseCreation = await fetch(urlCreation, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      },
      body: JSON.stringify({
        ref: `refs/heads/${nomNouvelleBranche}`,
        sha: shaDernierCommit
      })
    });

    if (!reponseCreation.ok) {
      const erreurText = await reponseCreation.text();
      console.log('❌ [GitHub] Échec de la création de la branche:', reponseCreation.status, erreurText);
      throw new Error(`Échec de création de la branche: ${erreurText}`);
    }

    console.log(`✅ [GitHub] Branche ${nomNouvelleBranche} créée avec succès`);
    return nomNouvelleBranche;
  } catch (erreur) {
    console.error('❌ [GitHub] Échec lors de la création de la branche:', erreur);
    throw erreur;
  }
}

/**
 * Commite et pousse les modifications d'un fichier sur une branche donnée
 * 
 * Exemple :
 * await commiterFichier("token...", "octocat", "Hello-World", "README.md", "Nouveau texte", "sha123...", "Mise à jour doc", "feature/ma-branche");
 */
export async function commiterFichier(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  sha: string,
  message: string,
  branch: string
): Promise<void> {
  console.log(`🚀 [GitHub] Commit des modifications du fichier ${path} sur la branche ${branch}`);
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const contenuBase64 = encodeBase64(content);

    const reponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      },
      body: JSON.stringify({
        message: message,
        content: contenuBase64,
        sha: sha,
        branch: branch
      })
    });

    if (!reponse.ok) {
      const erreurText = await reponse.text();
      console.log('❌ [GitHub] Échec du commit:', reponse.status, erreurText);
      throw new Error(`Échec de commit: ${erreurText}`);
    }

    console.log(`✅ [GitHub] Commit effectué avec succès sur ${branch}`);
  } catch (erreur) {
    console.error('❌ [GitHub] Échec lors du commit du fichier:', erreur);
    throw erreur;
  }
}

/**
 * Ouvre une Pull Request sur GitHub
 * 
 * Exemple :
 * const prUrl = await creerPullRequest("token...", "octocat", "Hello-World", "Ajout feature", "Description...", "feature/ma-branche", "main");
 */
export async function creerPullRequest(
  token: string,
  owner: string,
  repo: string,
  titre: string,
  description: string,
  brancheSource: string,
  brancheCible: string
): Promise<string> {
  console.log(`🚀 [GitHub] Création de la Pull Request de ${brancheSource} vers ${brancheCible}`);
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
    const reponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      },
      body: JSON.stringify({
        title: titre,
        body: description,
        head: brancheSource,
        base: brancheCible
      })
    });

    if (!reponse.ok) {
      const erreurText = await reponse.text();
      console.log('❌ [GitHub] Échec de création de la PR:', reponse.status, erreurText);
      throw new Error(`Échec de création de la PR: ${erreurText}`);
    }

    const donnees = await reponse.json();
    console.log('✅ [GitHub] Pull Request créée avec succès:', donnees.html_url);
    return donnees.html_url;
  } catch (erreur) {
    console.error('❌ [GitHub] Échec lors de la création de la PR:', erreur);
    throw erreur;
  }
}
