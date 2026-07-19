import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  StatusBar,
  Linking
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Importation des fonctions de services
import {
  recupererArborescence,
  recupererContenuFichiersEnParallele,
  creerNouvelleBranche,
  commiterPlusieursFichiers,
  creerPullRequest,
  recupererWorkflows,
  declencherWorkflow,
  recupererDerniereExecutionBranche,
  recupererLogsErreurJob,
  ExecutionWorkflow
} from './src/services/github';
import { modifierCodeAvecGemini, ModificationFichier } from './src/services/gemini';

// Clé de stockage
const CLE_STORAGE_CONFIG = '@remote_code_config';

export default function App() {
  // --- États de configuration (API et Dépôt) ---
  const [tokenGithub, setTokenGithub] = useState('');
  const [cleGemini, setCleGemini] = useState('');
  const [proprietaire, setProprietaire] = useState('');
  const [nomDepot, setNomDepot] = useState('');
  const [brancheCible, setBrancheCible] = useState('main');

  // --- États d'arborescence et sélection de fichiers ---
  const [arborescence, setArborescence] = useState<string[]>([]);
  const [fichiersCiblesSelectionnes, setFichiersCiblesSelectionnes] = useState<string[]>([]);
  const [fichiersContexteSelectionnes, setFichiersContexteSelectionnes] = useState<string[]>([]);
  const [texteFiltreRecherche, setTexteFiltreRecherche] = useState('');

  // --- Contenus des fichiers chargés en local ---
  const [fichiersCharges, setFichiersCharges] = useState<Array<{ path: string; content: string; sha: string }>>([]);

  // --- Résultats de modification par l'IA ---
  const [modificationsIA, setModificationsIA] = useState<ModificationFichier[]>([]);
  const [fichierVisuActif, setFichierVisuActif] = useState('');

  // --- États de GitHub Actions (CI/CD - Étape 3) ---
  const [workflows, setWorkflows] = useState<Array<{ id: number; name: string; path: string }>>([]);
  const [workflowSelectionne, setWorkflowSelectionne] = useState<string | number>('');
  const [brancheDerniereSoumission, setBrancheDerniereSoumission] = useState('');
  const [derniereExecution, setDerniereExecution] = useState<ExecutionWorkflow | null>(null);
  const [logsErreurCI, setLogsErreurCI] = useState('');
  const [surveillanceActive, setSurveillanceActive] = useState(false);
  const intervalleSurveillance = useRef<NodeJS.Timeout | null>(null);

  // --- États généraux ---
  const [chargement, setChargement] = useState(false);
  const [etapeChargement, setEtapeChargement] = useState('');
  const [afficherConfig, setAfficherConfig] = useState(true);
  const [consigne, setConsigne] = useState('');
  const [ongletActif, setOngletActif] = useState<'original' | 'modifie'>('original');
  const [urlPullRequest, setUrlPullRequest] = useState('');

  // Charge la configuration sauvegardée
  useEffect(() => {
    chargerConfiguration();
    return () => {
      // Nettoie l'intervalle de surveillance au démontage
      if (intervalleSurveillance.current) {
        clearInterval(intervalleSurveillance.current);
      }
    };
  }, []);

  // Charge la configuration stockée
  // Exemple : chargerConfiguration()
  const chargerConfiguration = async () => {
    try {
      console.log('🚀 [App] Chargement de la configuration...');
      const donneesStockees = await AsyncStorage.getItem(CLE_STORAGE_CONFIG);
      if (donneesStockees) {
        const config = JSON.parse(donneesStockees);
        setTokenGithub(config.tokenGithub || '');
        setCleGemini(config.cleGemini || '');
        setProprietaire(config.proprietaire || '');
        setNomDepot(config.nomDepot || '');
        setBrancheCible(config.brancheCible || 'main');
        setFichiersCiblesSelectionnes(config.fichiersCiblesSelectionnes || []);
        setFichiersContexteSelectionnes(config.fichiersContexteSelectionnes || []);
        console.log('✅ [App] Configuration chargée');
        
        // Si tout est renseigné, masquer la config
        if (config.tokenGithub && config.cleGemini && config.proprietaire && config.nomDepot) {
          setAfficherConfig(false);
          // On peut tenter de charger la liste des workflows configurés
          recupererEtDefinirWorkflows(config.tokenGithub, config.proprietaire, config.nomDepot);
        }
      }
    } catch (erreur) {
      console.error('❌ [App] Erreur de chargement configuration:', erreur);
    }
  };

  // Récupère les workflows de CI/CD configurés sur le dépôt
  const recupererEtDefinirWorkflows = async (token: string, owner: string, repo: string) => {
    try {
      const liste = await recupererWorkflows(token, owner, repo);
      setWorkflows(liste);
      if (liste.length > 0) {
        setWorkflowSelectionne(liste[0].id);
      }
    } catch (erreur) {
      console.error('❌ [App] Impossible de récupérer les workflows:', erreur);
    }
  };

  // Sauvegarde les paramètres de configuration
  // Exemple : sauvegarderConfiguration()
  const sauvegarderConfiguration = async () => {
    try {
      console.log('🚀 [App] Sauvegarde de la configuration...');
      const config = {
        tokenGithub,
        cleGemini,
        proprietaire,
        nomDepot,
        brancheCible,
        fichiersCiblesSelectionnes,
        fichiersContexteSelectionnes
      };
      await AsyncStorage.setItem(CLE_STORAGE_CONFIG, JSON.stringify(config));
      Alert.alert('Succès', 'Configuration enregistrée localement !');
      
      // Charge également les workflows après la sauvegarde
      recupererEtDefinirWorkflows(tokenGithub, proprietaire, nomDepot);
    } catch (erreur) {
      console.error('❌ [App] Erreur sauvegarde config:', erreur);
      Alert.alert('Erreur', 'Impossible d\'enregistrer la configuration.');
    }
  };

  // 1️⃣ CHARGEMENT DE L'ARBORESCENCE DU PROJET
  const gererChargementArborescence = async () => {
    if (!tokenGithub || !proprietaire || !nomDepot) {
      Alert.alert('Erreur', 'Veuillez saisir vos paramètres d\'accès GitHub.');
      setAfficherConfig(true);
      return;
    }

    setChargement(true);
    setEtapeChargement('Chargement de la structure des dossiers...');
    setArborescence([]);

    try {
      const arbre = await recupererArborescence(
        tokenGithub,
        proprietaire,
        nomDepot,
        brancheCible
      );
      setArborescence(arbre);
      Alert.alert('Succès', `${arbre.length} fichiers identifiés dans le dépôt !`);
      
      // On en profite pour lister les workflows de CI
      await recupererEtDefinirWorkflows(tokenGithub, proprietaire, nomDepot);
    } catch (erreur: any) {
      Alert.alert('Erreur', erreur.message || 'Impossible de lire l\'arborescence.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 2️⃣ RÉCUPÉRATION PARALLÈLE DE TOUS LES FICHIERS SÉLECTIONNÉS
  const gererChargementFichiers = async () => {
    if (fichiersCiblesSelectionnes.length === 0) {
      Alert.alert('Erreur', 'Sélectionnez au moins un fichier cible à modifier.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Chargement des fichiers sélectionnés en parallèle...');
    setFichiersCharges([]);
    setModificationsIA([]);
    setUrlPullRequest('');
    setDerniereExecution(null);
    setLogsErreurCI('');

    const cheminsACharger = Array.from(
      new Set([...fichiersCiblesSelectionnes, ...fichiersContexteSelectionnes])
    );

    try {
      const resultats = await recupererContenuFichiersEnParallele(
        tokenGithub,
        proprietaire,
        nomDepot,
        cheminsACharger,
        brancheCible
      );
      setFichiersCharges(resultats);
      
      setFichierVisuActif(fichiersCiblesSelectionnes[0]);
      setOngletActif('original');

      Alert.alert('Succès', `${resultats.length} fichier(s) chargé(s) avec succès !`);
    } catch (erreur: any) {
      Alert.alert('Erreur de chargement', erreur.message || 'Échec du téléchargement.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 3️⃣ GENERATION ET APPLICATION DES MODIFICATIONS PAR GEMINI
  const gererModificationCode = async () => {
    if (!cleGemini) {
      Alert.alert('Erreur', 'Veuillez saisir votre clé API Gemini.');
      setAfficherConfig(true);
      return;
    }
    if (fichiersCharges.length === 0) {
      Alert.alert('Erreur', 'Aucun fichier n\'est chargé.');
      return;
    }
    if (!consigne.trim()) {
      Alert.alert('Erreur', 'Veuillez rédiger une consigne pour l\'IA.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Gemini révise vos fichiers et génère les modifications...');
    setModificationsIA([]);

    const cibles = fichiersCharges.filter(f => fichiersCiblesSelectionnes.includes(f.path));
    const contextes = fichiersCharges.filter(f => fichiersContexteSelectionnes.includes(f.path));

    try {
      const modifs = await modifierCodeAvecGemini(
        cleGemini,
        arborescence,
        cibles,
        contextes,
        consigne
      );

      if (modifs.length === 0) {
        Alert.alert('Information', 'Gemini n\'a proposé aucune modification de code.');
        return;
      }

      setModificationsIA(modifs);
      
      setFichierVisuActif(modifs[0].path);
      setOngletActif('modifie');
      
      Alert.alert('Succès', `L'IA a modifié ${modifs.length} fichier(s) !`);
    } catch (erreur: any) {
      Alert.alert('Erreur de génération', erreur.message || 'L\'IA n\'a pas pu traiter la demande.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 4️⃣ COMMIT DE TOUTES LES MODIFICATIONS DANS UNE TRANSACTION UNIQUE
  const gererSoumissionGitHub = async () => {
    if (modificationsIA.length === 0) {
      Alert.alert('Erreur', 'Aucune modification à commiter.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Création de la branche...');

    const timestamp = Math.floor(Date.now() / 1000);
    const nomNouvelleBranche = `feature/remote-ia-${timestamp}`;
    const messageCommit = `[IA Code Remote] Modifications simultanées de ${modificationsIA.length} fichiers`;

    try {
      // Étape 4a : Création de la branche sur GitHub
      await creerNouvelleBranche(
        tokenGithub,
        proprietaire,
        nomDepot,
        brancheCible,
        nomNouvelleBranche
      );

      // Étape 4b : Commiter tous les fichiers modifiés en une fois (Git Database API)
      setEtapeChargement('Poussée atomique des modifications sur GitHub...');
      await commiterPlusieursFichiers(
        tokenGithub,
        proprietaire,
        nomDepot,
        modificationsIA.map(m => ({ path: m.path, content: m.content })),
        nomNouvelleBranche,
        messageCommit
      );

      // Étape 4c : Ouvrir la Pull Request
      setEtapeChargement('Création de la Pull Request...');
      const titrePR = `[IA] Modifie ${modificationsIA.length} fichier(s) du projet`;
      const descriptionPR = `Modifications appliquées via l'application mobile Télécommandeur de Code IA.\n\n**Consigne :**\n> ${consigne}\n\n**Fichiers modifiés :**\n${
        modificationsIA.map(m => `- \`${m.path}\` (${m.action})`).join('\n')
      }`;

      const prUrl = await creerPullRequest(
        tokenGithub,
        proprietaire,
        nomDepot,
        titrePR,
        descriptionPR,
        nomNouvelleBranche,
        brancheCible
      );

      setUrlPullRequest(prUrl);
      setBrancheDerniereSoumission(nomNouvelleBranche);
      
      Alert.alert(
        'Transaction validée ! 🎉',
        `Modifications poussées sur la branche ${nomNouvelleBranche}. Vous pouvez lancer les tests à distance.`
      );
    } catch (erreur: any) {
      Alert.alert('Erreur de validation', erreur.message || 'Impossible d\'enregistrer les modifications.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 5️⃣ GESTION DE GITHUB ACTIONS (Étape 3)
  // Déclenche le workflow de CI configuré sur la branche de feature poussée
  const gererDeclenchementCI = async () => {
    if (!brancheDerniereSoumission) {
      Alert.alert('Erreur', 'Veuillez d\'abord commiter des modifications pour pouvoir lancer la CI.');
      return;
    }
    if (!workflowSelectionne) {
      Alert.alert('Erreur', 'Aucun workflow sélectionné pour les tests.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Déclenchement du workflow GitHub Actions...');
    setLogsErreurCI('');
    setDerniereExecution(null);

    try {
      await declencherWorkflow(
        tokenGithub,
        proprietaire,
        nomDepot,
        workflowSelectionne,
        brancheDerniereSoumission
      );

      // Démarre la surveillance automatique toutes les 5 secondes
      lancerSurveillanceCI();
    } catch (erreur: any) {
      Alert.alert('Erreur Actions', erreur.message || 'Impossible de déclencher les tests.');
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // Initie la boucle périodique de surveillance de la CI
  const lancerSurveillanceCI = () => {
    if (intervalleSurveillance.current) {
      clearInterval(intervalleSurveillance.current);
    }

    setSurveillanceActive(true);
    setChargement(false);
    setEtapeChargement('');

    console.log('🚀 [App] Début de la surveillance CI...');
    
    // Premier appel immédiat
    verifierStatutCI();

    // Boucle toutes les 6 secondes
    intervalleSurveillance.current = setInterval(() => {
      verifierStatutCI();
    }, 6000);
  };

  // Interroge le statut de l'exécution sur la branche
  const verifierStatutCI = async () => {
    console.log('📡 [App] Vérification périodique de la CI...');
    try {
      const run = await recupererDerniereExecutionBranche(
        tokenGithub,
        proprietaire,
        nomDepot,
        brancheDerniereSoumission
      );

      if (run) {
        setDerniereExecution(run);
        
        // Si l'exécution est complétée, on stoppe la surveillance
        if (run.status === 'completed') {
          console.log(`✅ [App] CI terminée avec la conclusion : ${run.conclusion}`);
          
          if (intervalleSurveillance.current) {
            clearInterval(intervalleSurveillance.current);
          }
          setSurveillanceActive(false);

          if (run.conclusion === 'failure') {
            // En cas d'échec, on récupère le journal des erreurs du job
            const journalErreur = await recupererLogsErreurJob(
              tokenGithub,
              proprietaire,
              nomDepot,
              run.id
            );
            setLogsErreurCI(journalErreur);
            Alert.alert('CI Échouée 🔴', 'Des erreurs ont été détectées dans les tests. Option d\'auto-correction disponible.');
          } else if (run.conclusion === 'success') {
            Alert.alert('CI Réussie ! 🟢', 'Tous les tests et builds compilent avec succès !');
          }
        }
      }
    } catch (erreur) {
      console.error('❌ [App] Erreur lors de la vérification de la CI:', erreur);
    }
  };

  // 6️⃣ BOUCLE D'AUTO-CORRECTION
  // Transmet le journal d'erreur directement à Gemini pour génération corrective
  const gererAutoCorrection = () => {
    if (!logsErreurCI) return;
    
    // Injecter les erreurs dans le prompt consigne de l'utilisateur
    const consigneCorrective = `Le build ou les tests ont échoué sur GitHub Actions. Voici le rapport d'erreur :\n---\n${logsErreurCI}\n---\n\nCorrige le code des fichiers cibles pour résoudre ce problème.`;
    setConsigne(consigneCorrective);
    
    // Revenir sur le code original pour re-visualiser les modifications
    setOngletActif('original');
    // Effacer les logs d'erreurs d'affichage pour inciter au nouveau lancement
    setLogsErreurCI('');
    setDerniereExecution(null);

    Alert.alert('Auto-correction', 'Les erreurs de build ont été injectées dans le prompt. Saisissez d\'autres détails si besoin et cliquez sur "Demander modifications groupées" !');
  };

  // Alterner la sélection d'un fichier en tant que cible
  const alternerCible = (chemin: string) => {
    setFichiersCiblesSelectionnes(prev => {
      if (prev.includes(chemin)) {
        return prev.filter(p => p !== chemin);
      } else {
        setFichiersContexteSelectionnes(c => c.filter(p => p !== chemin));
        return [...prev, chemin];
      }
    });
  };

  // Alterner la sélection d'un fichier en tant que contexte
  const alternerContexte = (chemin: string) => {
    setFichiersContexteSelectionnes(prev => {
      if (prev.includes(chemin)) {
        return prev.filter(p => p !== chemin);
      } else {
        setFichiersCiblesSelectionnes(t => t.filter(p => p !== chemin));
        return [...prev, chemin];
      }
    });
  };

  // Ouvre le lien de la PR dans le navigateur
  const gererOuverturePR = () => {
    if (urlPullRequest) {
      Linking.openURL(urlPullRequest);
    }
  };

  // Filtrage de la liste pour la recherche
  const arborescenceFiltrée = arborescence.filter(chemin =>
    chemin.toLowerCase().includes(texteFiltreRecherche.toLowerCase())
  );

  // Recherche le code source d'origine d'un fichier chargé
  const obtenirCodeOriginal = (chemin: string): string => {
    const f = fichiersCharges.find(x => x.path === chemin);
    return f ? f.content : '// Contenu original non chargé (nouveau fichier créé par l\'IA)';
  };

  // Recherche le code source généré par l'IA pour un fichier
  const obtenirCodeModifie = (chemin: string): string => {
    const m = modificationsIA.find(x => x.path === chemin);
    return m ? m.content : obtenirCodeOriginal(chemin);
  };

  return (
    <SafeAreaView style={styles.conteneurSafeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />
      <View style={styles.conteneur}>
        
        {/* En-tête */}
        <View style={styles.enTete}>
          <View>
            <Text style={styles.titreApp}>🤖 IA Code Remote</Text>
            <Text style={styles.sousTitreApp}>Auto-correction & Actions (Étape 3)</Text>
          </View>
          <TouchableOpacity 
            style={styles.boutonReglages} 
            onPress={() => setAfficherConfig(!afficherConfig)}
          >
            <Text style={styles.texteBoutonReglages}>
              {afficherConfig ? '✕ Fermer' : '⚙️ Configuration'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Panneau de Configuration */}
        {afficherConfig && (
          <ScrollView style={styles.zoneConfig} contentContainerStyle={styles.zoneConfigContent}>
            <Text style={styles.titreSection}>🔑 Paramètres d'accès</Text>
            
            <Text style={styles.labelInput}>Clé API Gemini</Text>
            <TextInput
              style={styles.input}
              placeholder="Saisir la clé Gemini"
              placeholderTextColor="#64748B"
              secureTextEntry
              value={cleGemini}
              onChangeText={setCleGemini}
            />

            <Text style={styles.labelInput}>Token GitHub Personal Access</Text>
            <TextInput
              style={styles.input}
              placeholder="ghp_..."
              placeholderTextColor="#64748B"
              secureTextEntry
              value={tokenGithub}
              onChangeText={setTokenGithub}
            />

            <View style={styles.ligneDoubleInput}>
              <View style={styles.colonneInput}>
                <Text style={styles.labelInput}>Utilisateur GitHub</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ex: octocat"
                  placeholderTextColor="#64748B"
                  value={proprietaire}
                  onChangeText={setProprietaire}
                />
              </View>
              <View style={styles.colonneInput}>
                <Text style={styles.labelInput}>Dépôt GitHub</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ex: Hello-World"
                  placeholderTextColor="#64748B"
                  value={nomDepot}
                  onChangeText={setNomDepot}
                />
              </View>
            </View>

            <Text style={styles.labelInput}>Branche Source/Cible</Text>
            <TextInput
              style={styles.input}
              placeholder="ex: main"
              placeholderTextColor="#64748B"
              value={brancheCible}
              onChangeText={setBrancheCible}
            />

            <View style={styles.zoneActionsConfig}>
              <TouchableOpacity style={styles.boutonSecondaire} onPress={gererChargementArborescence}>
                <Text style={styles.texteBoutonSecondaire}>🔍 Charger l'arborescence</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.boutonSauvegarder} onPress={sauvegarderConfiguration}>
                <Text style={styles.texteBoutonSauvegarder}>💾 Enregistrer & Fermer</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}

        {/* Corps Principal */}
        {!afficherConfig && (
          <View style={styles.corpsPrincipal}>
            
            {/* Sélection d'arborescence (Si aucun fichier chargé) */}
            {arborescence.length > 0 && fichiersCharges.length === 0 && (
              <View style={styles.panneauArborescence}>
                <Text style={styles.titreSectionArbo}>📂 Marquez vos fichiers cibles et de contexte :</Text>
                
                <TextInput
                  style={styles.inputRecherche}
                  placeholder="Filtrer les fichiers du dépôt..."
                  placeholderTextColor="#64748B"
                  value={texteFiltreRecherche}
                  onChangeText={setTexteFiltreRecherche}
                />

                <ScrollView style={styles.defilementFichiers}>
                  {arborescenceFiltrée.map((chemin, index) => {
                    const estCible = fichiersCiblesSelectionnes.includes(chemin);
                    const estContexte = fichiersContexteSelectionnes.includes(chemin);

                    return (
                      <View key={index} style={styles.ligneFichier}>
                        <Text 
                          style={[
                            styles.texteCheminFichier,
                            estCible && styles.texteCibleSelectionne,
                            estContexte && styles.texteContexteSelectionne
                          ]}
                          numberOfLines={1}
                        >
                          {chemin}
                        </Text>
                        <View style={styles.ligneFichierActions}>
                          <TouchableOpacity
                            style={[styles.badgeAction, estCible ? styles.badgeCibleActif : styles.badgeInactif]}
                            onPress={() => alternerCible(chemin)}
                          >
                            <Text style={styles.texteBadge}>Cible 🎯</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.badgeAction, estContexte ? styles.badgeContexteActif : styles.badgeInactif]}
                            onPress={() => alternerContexte(chemin)}
                          >
                            <Text style={styles.texteBadge}>Contexte 👁️</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>

                <View style={styles.panneauSelectionSynthese}>
                  <Text style={styles.texteSynthese}>
                    🎯 Cibles : <Text style={styles.texteGras}>{fichiersCiblesSelectionnes.length} fichier(s)</Text>
                  </Text>
                  <Text style={styles.texteSynthese}>
                    👁️ Contextes : <Text style={styles.texteGras}>{fichiersContexteSelectionnes.length} fichier(s)</Text>
                  </Text>
                  
                  <TouchableOpacity 
                    style={[styles.boutonChargerContenus, fichiersCiblesSelectionnes.length === 0 && styles.boutonDesactive]}
                    disabled={fichiersCiblesSelectionnes.length === 0}
                    onPress={gererChargementFichiers}
                  >
                    <Text style={styles.texteBoutonChargerContenus}>📥 Charger les fichiers ({fichiersCiblesSelectionnes.length + fichiersContexteSelectionnes.length})</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Fichiers chargés */}
            {fichiersCharges.length > 0 && (
              <View style={styles.panneauFichiersPrets}>
                <View style={styles.panneauInfoFichierPret}>
                  <Text style={styles.texteInfoFichierPret}>
                    🎯 Cibles prêtes : <Text style={styles.texteGras}>{fichiersCiblesSelectionnes.length} fichier(s)</Text>
                  </Text>
                  <Text style={styles.texteInfoFichierPret}>
                    👁️ Contextes lus : <Text style={styles.texteGras}>{fichiersContexteSelectionnes.length} fichier(s)</Text>
                  </Text>
                </View>
                <TouchableOpacity 
                  style={styles.boutonChangerFichiers} 
                  onPress={() => {
                    setFichiersCharges([]);
                    setModificationsIA([]);
                  }}
                >
                  <Text style={styles.texteBoutonChangerFichiers}>🔄 Sélection</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Aucun projet configuré */}
            {arborescence.length === 0 && (
              <View style={styles.panneauVide}>
                <Text style={styles.texteVide}>Veuillez charger l'arborescence de votre projet.</Text>
                <TouchableOpacity style={styles.boutonSauvegarderSingle} onPress={() => setAfficherConfig(true)}>
                  <Text style={styles.texteBoutonSauvegarder}>⚙️ Ouvrir la configuration</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Zone d'Edition (Une fois fichiers chargés) */}
            {fichiersCharges.length > 0 && (
              <View style={styles.conteneurEdition}>
                
                {/* Sélecteur de fichier actif en cours de visualisation */}
                <View style={styles.barreSelectionFichierVisu}>
                  <Text style={styles.labelFichiersModifies}>Visualiser :</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollFichiersVisu}>
                    {modificationsIA.length > 0 
                      ? modificationsIA.map((mod, i) => (
                          <TouchableOpacity
                            key={i}
                            style={[styles.boutonFichierVisu, fichierVisuActif === mod.path && styles.boutonFichierVisuActif]}
                            onPress={() => setFichierVisuActif(mod.path)}
                          >
                            <Text style={[styles.texteFichierVisu, fichierVisuActif === mod.path && styles.texteFichierVisuActif]}>
                              {mod.path.split('/').pop()} ✨
                            </Text>
                          </TouchableOpacity>
                        ))
                      : fichiersCiblesSelectionnes.map((chemin, i) => (
                          <TouchableOpacity
                            key={i}
                            style={[styles.boutonFichierVisu, fichierVisuActif === chemin && styles.boutonFichierVisuActif]}
                            onPress={() => setFichierVisuActif(chemin)}
                          >
                            <Text style={[styles.texteFichierVisu, fichierVisuActif === chemin && styles.texteFichierVisuActif]}>
                              {chemin.split('/').pop()}
                            </Text>
                          </TouchableOpacity>
                        ))
                    }
                  </ScrollView>
                </View>

                {/* Onglets Original vs Modifié */}
                <View style={styles.barreOnglets}>
                  <TouchableOpacity
                    style={[styles.onglet, ongletActif === 'original' && styles.ongletActif]}
                    onPress={() => setOngletActif('original')}
                  >
                    <Text style={[styles.texteOnglet, ongletActif === 'original' && styles.texteOngletActif]}>
                      Code Original
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.onglet, 
                      ongletActif === 'modifie' && styles.ongletActif,
                      modificationsIA.length === 0 && styles.ongletDesactive
                    ]}
                    disabled={modificationsIA.length === 0}
                    onPress={() => setOngletActif('modifie')}
                  >
                    <Text style={[
                      styles.texteOnglet, 
                      ongletActif === 'modifie' && styles.texteOngletActif,
                      modificationsIA.length === 0 && styles.texteOngletDesactive
                    ]}>
                      Code Modifié ✨
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Editeur de code */}
                <View style={styles.zoneCode}>
                  <ScrollView style={styles.defilementCode} horizontal>
                    <ScrollView>
                      <Text style={styles.texteCodeMonospace}>
                        {ongletActif === 'original' 
                          ? obtenirCodeOriginal(fichierVisuActif)
                          : obtenirCodeModifie(fichierVisuActif)
                        }
                      </Text>
                    </ScrollView>
                  </ScrollView>
                </View>

                {/* Zone d'intégration continue (CI/CD - Étape 3) */}
                {brancheDerniereSoumission !== '' && (
                  <View style={[
                    styles.conteneurCI,
                    derniereExecution?.conclusion === 'success' && styles.conteneurCISucces,
                    derniereExecution?.conclusion === 'failure' && styles.conteneurCIEchec,
                    surveillanceActive && styles.conteneurCIEncours
                  ]}>
                    <Text style={styles.titreSectionCI}>⚙️ Validation Intégration Continue (CI/CD)</Text>
                    
                    {workflows.length > 0 && !surveillanceActive && !derniereExecution && (
                      <View style={styles.ligneDeclenchementCI}>
                        <Text style={styles.labelFiltreCI}>Workflow :</Text>
                        <ScrollView horizontal style={styles.scrollWorkflowsCI}>
                          {workflows.map((w, idx) => (
                            <TouchableOpacity
                              key={idx}
                              style={[styles.badgeWorkflow, workflowSelectionne === w.id && styles.badgeWorkflowActif]}
                              onPress={() => setWorkflowSelectionne(w.id)}
                            >
                              <Text style={styles.texteBadgeWorkflow}>{w.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                        <TouchableOpacity style={styles.boutonRunCI} onPress={gererDeclenchementCI}>
                          <Text style={styles.texteBoutonRunCI}>🚀 Run CI</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Affichage du statut de build en cours */}
                    {derniereExecution && (
                      <View style={styles.panneauStatutCI}>
                        <Text style={styles.texteStatutCI}>
                          Statut : <Text style={styles.texteGras}>{
                            derniereExecution.status === 'completed' 
                              ? `Complété (${derniereExecution.conclusion === 'success' ? 'Succès ✅' : 'Échec ❌'})`
                              : `En cours (${derniereExecution.status} 🟡)`
                          }</Text>
                        </Text>
                        {surveillanceActive && <ActivityIndicator size="small" color="#3B82F6" style={{marginLeft: 10}} />}
                        
                        <TouchableOpacity 
                          style={styles.boutonLienCI} 
                          onPress={() => Linking.openURL(derniereExecution.html_url)}
                        >
                          <Text style={styles.texteBoutonLienCI}>👁️ Voir run</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Si la CI a échoué : Option d'Auto-Correction IA */}
                    {logsErreurCI !== '' && (
                      <View style={styles.panneauCorrectionCI}>
                        <Text style={styles.texteErreurExtrait} numberOfLines={2}>
                          {logsErreurCI}
                        </Text>
                        <TouchableOpacity style={styles.boutonAutoCorrection} onPress={gererAutoCorrection}>
                          <Text style={styles.texteBoutonAutoCorrection}>🔧 Injecter les erreurs dans Gemini</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}

                {/* Zone de console instructions */}
                <View style={styles.zoneConsole}>
                  <TextInput
                    style={styles.inputConsigne}
                    placeholder="Saisissez vos consignes globales d'édition..."
                    placeholderTextColor="#64748B"
                    value={consigne}
                    onChangeText={setConsigne}
                    multiline
                    numberOfLines={2}
                  />
                  <TouchableOpacity 
                    style={styles.boutonGenerer}
                    onPress={gererModificationCode}
                  >
                    <Text style={styles.texteBoutonGenerer}>🧠 Demander modifications groupées</Text>
                  </TouchableOpacity>
                </View>

                {/* Bouton de validation final */}
                {modificationsIA.length > 0 && (
                  <View style={styles.zoneSoumission}>
                    <TouchableOpacity style={styles.boutonCommiter} onPress={gererSoumissionGitHub}>
                      <Text style={styles.texteBoutonCommiter}>🚀 Valider & Commiter ({modificationsIA.length} fichiers)</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Lien Pull Request */}
                {urlPullRequest !== '' && (
                  <TouchableOpacity style={styles.boutonPr} onPress={gererOuverturePR}>
                    <Text style={styles.texteBoutonPr}>🔗 Ouvrir la Pull Request sur GitHub</Text>
                  </TouchableOpacity>
                )}

              </View>
            )}

          </View>
        )}

        {/* Indicateur de chargement global */}
        {chargement && (
          <View style={styles.surimpressionChargement}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.texteChargement}>{etapeChargement}</Text>
          </View>
        )}

      </View>
    </SafeAreaView>
  );
}

// --- Styles UI Premium ---
const styles = StyleSheet.create({
  conteneurSafeArea: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  conteneur: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  enTete: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  titreApp: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  sousTitreApp: {
    fontSize: 11,
    color: '#3B82F6',
    fontWeight: '600',
    marginTop: 2,
  },
  boutonReglages: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  texteBoutonReglages: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  zoneConfig: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  zoneConfigContent: {
    padding: 16,
  },
  titreSection: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginBottom: 16,
  },
  labelInput: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 6,
    marginTop: 10,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0B0F19',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 14,
  },
  ligneDoubleInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  colonneInput: {
    flex: 0.48,
  },
  zoneActionsConfig: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  boutonSecondaire: {
    flex: 0.48,
    backgroundColor: '#1E293B',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  texteBoutonSecondaire: {
    color: '#3B82F6',
    fontWeight: 'bold',
    fontSize: 13,
  },
  boutonSauvegarder: {
    flex: 0.48,
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  boutonSauvegarderSingle: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  texteBoutonSauvegarder: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  corpsPrincipal: {
    flex: 1,
    padding: 16,
  },
  panneauArborescence: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  titreSectionArbo: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  inputRecherche: {
    backgroundColor: '#0B0F19',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 13,
    marginBottom: 12,
  },
  defilementFichiers: {
    flex: 1,
  },
  ligneFichier: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  texteCheminFichier: {
    color: '#94A3B8',
    fontSize: 12,
    flex: 0.55,
  },
  texteCibleSelectionne: {
    color: '#10B981',
    fontWeight: 'bold',
  },
  texteContexteSelectionne: {
    color: '#3B82F6',
    fontWeight: 'bold',
  },
  ligneFichierActions: {
    flexDirection: 'row',
    flex: 0.42,
    justifyContent: 'flex-end',
  },
  badgeAction: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginLeft: 6,
  },
  badgeCibleActif: {
    backgroundColor: '#10B981',
  },
  badgeContexteActif: {
    backgroundColor: '#3B82F6',
  },
  badgeInactif: {
    backgroundColor: '#1E293B',
    opacity: 0.5,
  },
  texteBadge: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  panneauSelectionSynthese: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  texteSynthese: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 4,
  },
  texteGras: {
    color: '#F8FAFC',
    fontWeight: 'bold',
  },
  boutonChargerContenus: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  texteBoutonChargerContenus: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  panneauFichiersPrets: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 12,
  },
  panneauInfoFichierPret: {
    flex: 0.75,
  },
  texteInfoFichierPret: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 2,
  },
  boutonChangerFichiers: {
    flex: 0.22,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  texteBoutonChangerFichiers: {
    color: '#3B82F6',
    fontSize: 11,
    fontWeight: 'bold',
  },
  panneauVide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  texteVide: {
    color: '#64748B',
    fontSize: 14,
    marginBottom: 16,
  },
  conteneurEdition: {
    flex: 1,
  },
  barreSelectionFichierVisu: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  labelFichiersModifies: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: 'bold',
    marginRight: 8,
    marginLeft: 4,
  },
  scrollFichiersVisu: {
    flex: 1,
  },
  boutonFichierVisu: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  boutonFichierVisuActif: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  texteFichierVisu: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: 'bold',
  },
  texteFichierVisuActif: {
    color: '#FFFFFF',
  },
  barreOnglets: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  onglet: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#1E293B',
  },
  ongletActif: {
    borderBottomColor: '#3B82F6',
  },
  ongletDesactive: {
    opacity: 0.5,
  },
  texteOnglet: {
    color: '#64748B',
    fontWeight: 'bold',
    fontSize: 12,
  },
  texteOngletActif: {
    color: '#F8FAFC',
  },
  texteOngletDesactive: {
    color: '#334155',
  },
  zoneCode: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  defilementCode: {
    flex: 1,
  },
  texteCodeMonospace: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#10B981',
    lineHeight: 15,
  },
  conteneurCI: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginVertical: 10,
  },
  conteneurCISucces: {
    borderColor: '#10B981',
    backgroundColor: '#062016',
  },
  conteneurCIEchec: {
    borderColor: '#EF4444',
    backgroundColor: '#2D0E12',
  },
  conteneurCIEncours: {
    borderColor: '#EAB308',
  },
  titreSectionCI: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  ligneDeclenchementCI: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelFiltreCI: {
    color: '#94A3B8',
    fontSize: 11,
    marginRight: 6,
  },
  scrollWorkflowsCI: {
    flex: 1,
  },
  badgeWorkflow: {
    backgroundColor: '#1E293B',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  badgeWorkflowActif: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  texteBadgeWorkflow: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  boutonRunCI: {
    backgroundColor: '#3B82F6',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  texteBoutonRunCI: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  panneauStatutCI: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  texteStatutCI: {
    color: '#94A3B8',
    fontSize: 12,
  },
  boutonLienCI: {
    backgroundColor: '#1E293B',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  texteBoutonLienCI: {
    color: '#3B82F6',
    fontSize: 10,
    fontWeight: 'bold',
  },
  panneauCorrectionCI: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EF4444',
    paddingTop: 8,
  },
  texteErreurExtrait: {
    color: '#FCA5A5',
    fontFamily: 'monospace',
    fontSize: 10,
    marginBottom: 8,
  },
  boutonAutoCorrection: {
    backgroundColor: '#EF4444',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  texteBoutonAutoCorrection: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  zoneConsole: {
    marginTop: 12,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  inputConsigne: {
    backgroundColor: '#0B0F19',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 13,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  boutonGenerer: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  texteBoutonGenerer: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  zoneSoumission: {
    marginTop: 10,
  },
  boutonCommiter: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  texteBoutonCommiter: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  boutonPr: {
    backgroundColor: '#6366F1',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  texteBoutonPr: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  surimpressionChargement: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(11, 15, 25, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  texteChargement: {
    color: '#F8FAFC',
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
  },
  boutonDesactive: {
    backgroundColor: '#1E293B',
    opacity: 0.5,
  },
});
