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

/**
 * Récupère l'arborescence complète (fichiers textuels uniquement) d'un dépôt GitHub.
 * Gère automatiquement le flag `truncated` de l'API GitHub (grands dépôts > 100 000 entrées).
 *
 * Exemple :
 * const arbo = await recupererArborescence("token...", "octocat", "Hello-World", "main");
 * console.log(arbo); // ["README.md", "src/App.tsx", ...]
 */
export async function recupererArborescence(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string[]> {
  console.log(`🚀 [GitHub] Récupération de l'arborescence pour ${owner}/${repo} [${branch}]`);

  const enTetes = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'RemoteCodeController-App'
  };

  // Filtre les fichiers à exclure (binaires, dépendances, builds)
  const extensionsExclues = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
    '.ttf', '.otf', '.woff', '.woff2',
    '.mp4', '.mp3', '.pdf', '.zip', '.tar.gz', '.apk', '.aab',
    '.db', '.sqlite', '.exe', '.dll', '.bin'
  ];
  const dossiersExclus = [
    'node_modules/', '.git/', '.expo/', 'ios/', 'android/',
    'web-build/', 'dist/', 'build/', 'out/', '.next/'
  ];

  const fichierEstValide = (chemin: string): boolean => {
    const dansDossierExclu = dossiersExclus.some(
      d => chemin.startsWith(d) || chemin.includes('/' + d)
    );
    const aExtensionExclue = extensionsExclues.some(
      ext => chemin.toLowerCase().endsWith(ext)
    );
    return !dansDossierExclu && !aExtensionExclue;
  };

  try {
    // Première tentative : arborescence récursive complète en un seul appel
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const reponse = await fetch(url, { method: 'GET', headers: enTetes });

    if (!reponse.ok) {
      const erreurText = await reponse.text();
      throw new Error(`Impossible de charger l'arborescence: ${erreurText}`);
    }

    const donnees = await reponse.json();
    if (!donnees.tree || !Array.isArray(donnees.tree)) {
      throw new Error("Format d'arborescence invalide reçu de GitHub.");
    }

    // Si l'arborescence n'est PAS tronquée, on l'utilise directement
    if (!donnees.truncated) {
      const fichiersFiltres = donnees.tree
        .filter((n: any) => n.type === 'blob' && fichierEstValide(n.path))
        .map((n: any) => n.path);

      console.log(`✅ [GitHub] Arborescence complète: ${fichiersFiltres.length} fichiers`);
      return fichiersFiltres;
    }

    // Si TRONQUÉE : le repo est trop grand, on récupère les sous-arbres manuellement
    console.log('⚠️ [GitHub] Arborescence tronquée — récupération des sous-arbres en parallèle...');

    // Récupérer les SHA des sous-dossiers de premier niveau depuis la réponse tronquée
    const sousDossiersRacine = donnees.tree.filter(
      (n: any) => n.type === 'tree' && !n.path.includes('/')
    );

    // Pour chaque sous-dossier, récupérer son arbre complet en parallèle
    const promessesArbres = sousDossiersRacine.map(async (dossier: any) => {
      const urlSousArbre = `https://api.github.com/repos/${owner}/${repo}/git/trees/${dossier.sha}?recursive=1`;
      try {
        const rep = await fetch(urlSousArbre, { method: 'GET', headers: enTetes });
        if (!rep.ok) return [];
        const data = await rep.json();
        return (data.tree || [])
          .filter((n: any) => n.type === 'blob')
          .map((n: any) => `${dossier.path}/${n.path}`);
      } catch {
        return [];
      }
    });

    // Fichiers de la racine directement (non dans un sous-dossier)
    const fichierRacine = donnees.tree
      .filter((n: any) => n.type === 'blob' && !n.path.includes('/'))
      .map((n: any) => n.path);

    const resultatsArbres = await Promise.all(promessesArbres);
    const tousLesFichiers = [
      ...fichierRacine,
      ...resultatsArbres.flat()
    ].filter(fichierEstValide);

    console.log(`✅ [GitHub] Arborescence reconstituée (${tousLesFichiers.length} fichiers après sous-arbres)`);
    return tousLesFichiers;

  } catch (erreur) {
    console.error('❌ [GitHub] Échec de chargement de l\'arborescence:', erreur);
    throw erreur;
  }
}


/**
 * Récupère le contenu et les SHA de plusieurs fichiers en parallèle
 * 
 * Exemple :
 * const fichiers = await recupererContenuFichiersEnParallele("token...", "octocat", "Hello-World", ["App.tsx", "package.json"], "main");
 */
export async function recupererContenuFichiersEnParallele(
  token: string,
  owner: string,
  repo: string,
  chemins: string[],
  branch: string
): Promise<Array<{ path: string; content: string; sha: string }>> {
  console.log(`🚀 [GitHub] Chargement en parallèle de ${chemins.length} fichiers...`);
  try {
    const promesses = chemins.map(async (chemin) => {
      const fichier = await recupererContenuFichier(token, owner, repo, chemin, branch);
      return {
        path: chemin,
        content: fichier.content,
        sha: fichier.sha
      };
    });
    const resultats = await Promise.all(promesses);
    console.log(`✅ [GitHub] Tous les ${chemins.length} fichiers ont été chargés avec succès`);
    return resultats;
  } catch (erreur) {
    console.error('❌ [GitHub] Échec du chargement parallèle des fichiers:', erreur);
    throw erreur;
  }
}

/**
 * Commite et pousse plusieurs fichiers en une seule transaction (un seul commit) sur une branche
 * Utilise l'API de bas niveau Git Database de GitHub
 * 
 * Exemple :
 * await commiterPlusieursFichiers("token...", "octocat", "Hello-World", [
 *   { path: "App.tsx", content: "..." },
 *   { path: "package.json", content: "..." }
 * ], "feature/branche-ia", "Mise à jour multi-fichiers");
 */
export async function commiterPlusieursFichiers(
  token: string,
  owner: string,
  repo: string,
  modifications: Array<{ path: string; content: string }>,
  branch: string,
  message: string
): Promise<string> {
  console.log(`🚀 [GitHub] Début du commit multi-fichiers (${modifications.length} fichiers) sur la branche ${branch}`);
  try {
    const enTetes = {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'RemoteCodeController-App'
    };

    // Étape 1 : Récupérer le SHA du dernier commit de la branche cible
    console.log('📡 [GitHub] Étape 1 : Récupération du SHA de la branche...');
    const urlRef = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`;
    const reponseRef = await fetch(urlRef, { method: 'GET', headers: enTetes });
    if (!reponseRef.ok) {
      throw new Error(`Impossible de trouver la branche ${branch} : ${await reponseRef.text()}`);
    }
    const donneesRef = await reponseRef.json();
    const shaDernierCommit = donneesRef.object.sha;
    console.log('✅ SHA dernier commit :', shaDernierCommit);

    // Étape 2 : Récupérer le commit parent pour obtenir son Tree SHA
    console.log('📡 [GitHub] Étape 2 : Récupération du Tree de base...');
    const urlCommit = `https://api.github.com/repos/${owner}/${repo}/git/commits/${shaDernierCommit}`;
    const reponseCommit = await fetch(urlCommit, { method: 'GET', headers: enTetes });
    if (!reponseCommit.ok) {
      throw new Error(`Impossible de lire le commit parent : ${await reponseCommit.text()}`);
    }
    const donneesCommit = await reponseCommit.json();
    const shaBaseTree = donneesCommit.tree.sha;
    console.log('✅ SHA base tree :', shaBaseTree);

    // Étape 3 : Créer un nouveau Tree contenant les modifications
    console.log('📡 [GitHub] Étape 3 : Création du nouveau Tree sur GitHub...');
    const urlTree = `https://api.github.com/repos/${owner}/${repo}/git/trees`;
    const corpsTree = {
      base_tree: shaBaseTree,
      tree: modifications.map(mod => ({
        path: mod.path,
        mode: '100644', // Fichier standard non exécutable
        type: 'blob',
        content: mod.content
      }))
    };
    const reponseTree = await fetch(urlTree, {
      method: 'POST',
      headers: enTetes,
      body: JSON.stringify(corpsTree)
    });
    if (!reponseTree.ok) {
      throw new Error(`Échec de création du Tree : ${await reponseTree.text()}`);
    }
    const donneesTree = await reponseTree.json();
    const shaNouveauTree = donneesTree.sha;
    console.log('✅ Nouveau Tree créé, SHA :', shaNouveauTree);

    // Étape 4 : Créer un nouveau Commit pointant sur ce nouveau Tree
    console.log('📡 [GitHub] Étape 4 : Création du nouveau Commit...');
    const urlNouveauCommit = `https://api.github.com/repos/${owner}/${repo}/git/commits`;
    const corpsCommit = {
      message: message,
      tree: shaNouveauTree,
      parents: [shaDernierCommit]
    };
    const reponseNouveauCommit = await fetch(urlNouveauCommit, {
      method: 'POST',
      headers: enTetes,
      body: JSON.stringify(corpsCommit)
    });
    if (!reponseNouveauCommit.ok) {
      throw new Error(`Échec de création du Commit : ${await reponseNouveauCommit.text()}`);
    }
    const donneesNouveauCommit = await reponseNouveauCommit.json();
    const shaNouveauCommit = donneesNouveauCommit.sha;
    console.log('✅ Nouveau Commit créé, SHA :', shaNouveauCommit);

    // Étape 5 : Mettre à jour la référence de la branche
    console.log('📡 [GitHub] Étape 5 : Mise à jour de la branche...');
    const urlMajRef = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`;
    const corpsMajRef = {
      sha: shaNouveauCommit,
      force: true
    };
    const reponseMajRef = await fetch(urlMajRef, {
      method: 'PATCH',
      headers: enTetes,
      body: JSON.stringify(corpsMajRef)
    });
    if (!reponseMajRef.ok) {
      throw new Error(`Échec de mise à jour de la branche : ${await reponseMajRef.text()}`);
    }
    console.log(`✅ [GitHub] Succès ! Branche ${branch} mise à jour avec le commit multi-fichiers`);
    return shaNouveauCommit;
  } catch (erreur) {
    console.error('❌ [GitHub] Échec du commit multi-fichiers:', erreur);
    throw erreur;
  }
}

/**
 * Récupère la liste des workflows GitHub Actions configurés sur le dépôt
 * 
 * Exemple :
 * const workflows = await recupererWorkflows("token...", "octocat", "Hello-World");
 */
export async function recupererWorkflows(
  token: string,
  owner: string,
  repo: string
): Promise<Array<{ id: number; name: string; path: string }>> {
  console.log(`🚀 [GitHub Actions] Récupération des workflows pour ${owner}/${repo}`);
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows`;
    const reponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      }
    });

    if (!reponse.ok) {
      console.log('❌ [GitHub Actions] Aucun workflow ou accès refusé');
      return [];
    }

    const donnees = await reponse.json();
    return (donnees.workflows || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      path: w.path
    }));
  } catch (erreur) {
    console.error('❌ [GitHub Actions] Erreur lors de la lecture des workflows:', erreur);
    return [];
  }
}

/**
 * Déclenche manuellement un workflow sur une branche donnée (workflow_dispatch)
 * 
 * Exemple :
 * await declencherWorkflow("token...", "octocat", "Hello-World", "tests.yml", "feature/ma-branche");
 */
export async function declencherWorkflow(
  token: string,
  owner: string,
  repo: string,
  workflowId: string | number,
  branch: string
): Promise<void> {
  console.log(`🚀 [GitHub Actions] Déclenchement du workflow ${workflowId} sur ${branch}`);
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;
    const reponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      },
      body: JSON.stringify({
        ref: branch
      })
    });

    if (!reponse.ok && reponse.status !== 204) {
      const erreurText = await reponse.text();
      console.log('❌ [GitHub Actions] Échec de déclenchement:', reponse.status, erreurText);
      throw new Error(`Échec du déclenchement du workflow: ${erreurText}`);
    }

    console.log(`✅ [GitHub Actions] Workflow ${workflowId} déclenché avec succès !`);
  } catch (erreur) {
    console.error('❌ [GitHub Actions] Échec lors du déclenchement du workflow:', erreur);
    throw erreur;
  }
}

export interface ExecutionWorkflow {
  id: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | null;
  html_url: string;
  name: string;
}

/**
 * Récupère la dernière exécution du workflow sur la branche spécifiée
 * 
 * Exemple :
 * const exec = await recupererDerniereExecutionBranche("token...", "octocat", "Hello-World", "feature/ma-branche");
 */
export async function recupererDerniereExecutionBranche(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<ExecutionWorkflow | null> {
  console.log(`🚀 [GitHub Actions] Vérification du statut sur la branche ${branch}`);
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=1`;
    const reponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      }
    });

    if (!reponse.ok) {
      return null;
    }

    const donnees = await reponse.json();
    if (!donnees.workflow_runs || donnees.workflow_runs.length === 0) {
      return null;
    }

    const run = donnees.workflow_runs[0];
    return {
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      name: run.name
    };
  } catch (erreur) {
    console.error('❌ [GitHub Actions] Erreur lors de la lecture du statut d\'exécution:', erreur);
    return null;
  }
}

/**
 * Extrait les détails des erreurs d'un job en cas d'échec de la CI
 * 
 * Exemple :
 * const rapportErreurs = await recupererLogsErreurJob("token...", "octocat", "Hello-World", 12345678);
 */
export async function recupererLogsErreurJob(
  token: string,
  owner: string,
  repo: string,
  runId: number
): Promise<string> {
  console.log(`🚀 [GitHub Actions] Récupération des détails d'erreur pour l'exécution #${runId}`);
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
    const reponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      }
    });

    if (!reponse.ok) {
      return "Impossible de récupérer les détails de l'erreur.";
    }

    const donnees = await reponse.json();
    const jobsEnEchec = (donnees.jobs || []).filter((j: any) => j.conclusion === 'failure');

    if (jobsEnEchec.length === 0) {
      return "Aucun détail de job disponible.";
    }

    const lignesRapport: string[] = [];
    for (const job of jobsEnEchec) {
      lignesRapport.push(`Job échoué : "${job.name}"`);
      const etapesEnEchec = (job.steps || []).filter((s: any) => s.conclusion === 'failure');
      for (const etape of etapesEnEchec) {
        lignesRapport.push(` - Étape échouée : "${etape.name}" (Code de sortie: ${etape.number})`);
      }
    }

    return lignesRapport.join('\n');
  } catch (erreur) {
    console.error('❌ [GitHub Actions] Échec d\'extraction des détails d\'erreur:', erreur);
    return "Erreur lors de la récupération des détails d'échec CI.";
  }
}

/**
 * Crée un tout nouveau dépôt GitHub sur le compte de l'utilisateur.
 * Initialise automatiquement la branche `main` avec auto_init: true.
 * 
 * Exemple :
 * const nomRepo = await creerNouveauDepotGitHub("token...", "MonSuperProjet", "Description...", false);
 */
export async function creerNouveauDepotGitHub(
  token: string,
  nomRepo: string,
  description: string = 'Projet créé par IA Remote Code Controller',
  estPrive: boolean = false
): Promise<string> {
  console.log(`🚀 [GitHub] Création du nouveau dépôt "${nomRepo}"...`);
  try {
    const url = 'https://api.github.com/user/repos';
    const reponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RemoteCodeController-App'
      },
      body: JSON.stringify({
        name: nomRepo,
        description: description,
        private: estPrive,
        auto_init: true // Génère le premier commit sur la branche main avec un README.md
      })
    });

    if (!reponse.ok) {
      const erreurText = await reponse.text();
      console.log('❌ [GitHub] Échec de la création du dépôt:', reponse.status, erreurText);
      throw new Error(`Impossible de créer le dépôt GitHub (${reponse.status}): ${erreurText}`);
    }

    const donnees = await reponse.json();
    console.log(`✅ [GitHub] Dépôt ${donnees.full_name} créé avec succès !`);
    return donnees.name;
  } catch (erreur) {
    console.error('❌ [GitHub] Échec lors de la création du dépôt:', erreur);
    throw erreur;
  }
}




