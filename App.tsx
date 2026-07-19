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
  Linking,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  Animated,
  Dimensions
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// ─── Constantes ───────────────────────────────────────────────────────────────
const CLE_STORAGE_CONFIG = '@remote_code_config';
const { height: HAUTEUR_ECRAN } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────
type OngletPrincipal = 'projet' | 'chat' | 'ci';

interface MessageChat {
  id: string;
  role: 'user' | 'ia';
  texte: string;
  timestamp: Date;
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function App() {
  // Navigation par onglets
  const [ongletActif, setOngletActif] = useState<OngletPrincipal>('projet');

  // Configuration
  const [tokenGithub, setTokenGithub] = useState('');
  const [cleGemini, setCleGemini] = useState('');
  const [proprietaire, setProprietaire] = useState('');
  const [nomDepot, setNomDepot] = useState('');
  const [brancheCible, setBrancheCible] = useState('main');
  const [afficherConfig, setAfficherConfig] = useState(false);

  // Arborescence et sélection de fichiers
  const [arborescence, setArborescence] = useState<string[]>([]);
  const [fichiersCiblesSelectionnes, setFichiersCiblesSelectionnes] = useState<string[]>([]);
  const [fichiersContexteSelectionnes, setFichiersContexteSelectionnes] = useState<string[]>([]);
  const [texteFiltreRecherche, setTexteFiltreRecherche] = useState('');

  // Contenus des fichiers chargés
  const [fichiersCharges, setFichiersCharges] = useState<Array<{ path: string; content: string; sha: string }>>([]);

  // Modifications IA et visualisation de code
  const [modificationsIA, setModificationsIA] = useState<ModificationFichier[]>([]);
  const [fichierVisuActif, setFichierVisuActif] = useState('');
  const [modeVisu, setModeVisu] = useState<'original' | 'modifie'>('original');

  // Chat IA — Historique de la conversation
  const [messagesChat, setMessagesChat] = useState<MessageChat[]>([]);
  const [saisieConsigne, setSaisieConsigne] = useState('');
  const scrollChatRef = useRef<ScrollView>(null);
  const [chargementIA, setChargementIA] = useState(false);

  // GitHub Actions
  const [workflows, setWorkflows] = useState<Array<{ id: number; name: string; path: string }>>([]);
  const [workflowSelectionne, setWorkflowSelectionne] = useState<string | number>('');
  const [brancheDerniereSoumission, setBrancheDerniereSoumission] = useState('');
  const [derniereExecution, setDerniereExecution] = useState<ExecutionWorkflow | null>(null);
  const [logsErreurCI, setLogsErreurCI] = useState('');
  const [surveillanceActive, setSurveillanceActive] = useState(false);
  const [urlPullRequest, setUrlPullRequest] = useState('');
  const intervalleSurveillance = useRef<NodeJS.Timeout | null>(null);

  // Chargement global
  const [chargementGlobal, setChargementGlobal] = useState(false);
  const [etapeChargement, setEtapeChargement] = useState('');

  // Animation de l'onglet actif
  const animationBadge = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    chargerConfiguration();
    return () => {
      if (intervalleSurveillance.current) {
        clearInterval(intervalleSurveillance.current);
      }
    };
  }, []);

  // Scroll automatique vers le bas du chat après chaque nouveau message
  useEffect(() => {
    if (messagesChat.length > 0) {
      setTimeout(() => {
        scrollChatRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messagesChat]);

  // ─── CONFIGURATION ──────────────────────────────────────────────────────────

  const chargerConfiguration = async () => {
    try {
      const json = await AsyncStorage.getItem(CLE_STORAGE_CONFIG);
      if (json) {
        const c = JSON.parse(json);
        setTokenGithub(c.tokenGithub || '');
        setCleGemini(c.cleGemini || '');
        setProprietaire(c.proprietaire || '');
        setNomDepot(c.nomDepot || '');
        setBrancheCible(c.brancheCible || 'main');
        setFichiersCiblesSelectionnes(c.fichiersCiblesSelectionnes || []);
        setFichiersContexteSelectionnes(c.fichiersContexteSelectionnes || []);

        if (c.tokenGithub && c.cleGemini && c.proprietaire && c.nomDepot) {
          setAfficherConfig(false);
          recupererEtDefinirWorkflows(c.tokenGithub, c.proprietaire, c.nomDepot);
        } else {
          setAfficherConfig(true);
        }
      } else {
        setAfficherConfig(true);
      }
    } catch (e) {
      setAfficherConfig(true);
    }
  };

  const sauvegarderConfiguration = async () => {
    try {
      await AsyncStorage.setItem(CLE_STORAGE_CONFIG, JSON.stringify({
        tokenGithub, cleGemini, proprietaire, nomDepot, brancheCible,
        fichiersCiblesSelectionnes, fichiersContexteSelectionnes
      }));
      setAfficherConfig(false);
      recupererEtDefinirWorkflows(tokenGithub, proprietaire, nomDepot);
      Alert.alert('✅ Enregistré', 'Configuration sauvegardée avec succès.');
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder la configuration.');
    }
  };

  // ─── SERVICES GITHUB ────────────────────────────────────────────────────────

  const recupererEtDefinirWorkflows = async (token: string, owner: string, repo: string) => {
    const liste = await recupererWorkflows(token, owner, repo);
    setWorkflows(liste);
    if (liste.length > 0) setWorkflowSelectionne(liste[0].id);
  };

  const gererChargementArborescence = async () => {
    if (!tokenGithub || !proprietaire || !nomDepot) {
      Alert.alert('Configuration incomplète', 'Ouvrez d\'abord la configuration pour saisir vos accès GitHub.');
      setAfficherConfig(true);
      return;
    }
    setChargementGlobal(true);
    setEtapeChargement('Lecture du dépôt GitHub...');
    try {
      const arbre = await recupererArborescence(tokenGithub, proprietaire, nomDepot, brancheCible);
      setArborescence(arbre);
      await recupererEtDefinirWorkflows(tokenGithub, proprietaire, nomDepot);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de lire le dépôt.');
    } finally {
      setChargementGlobal(false);
      setEtapeChargement('');
    }
  };

  const gererChargementFichiers = async () => {
    const chemins = Array.from(new Set([...fichiersCiblesSelectionnes, ...fichiersContexteSelectionnes]));
    if (chemins.length === 0) {
      Alert.alert('Aucun fichier', 'Sélectionnez au moins un fichier cible (🎯).');
      return;
    }
    setChargementGlobal(true);
    setEtapeChargement(`Téléchargement de ${chemins.length} fichier(s)...`);
    try {
      const resultats = await recupererContenuFichiersEnParallele(tokenGithub, proprietaire, nomDepot, chemins, brancheCible);
      setFichiersCharges(resultats);
      setFichierVisuActif(fichiersCiblesSelectionnes[0] || '');
      setModeVisu('original');
      setModificationsIA([]);
      setUrlPullRequest('');
      setDerniereExecution(null);
      setLogsErreurCI('');
      setBrancheDerniereSoumission('');
      // Aller sur l'onglet Chat pour rédiger la consigne
      setOngletActif('chat');
      // Message de bienvenue dans le chat
      ajouterMessageSystem(`✅ ${resultats.length} fichier(s) chargé(s). Décrivez ce que vous voulez modifier !`);
    } catch (e: any) {
      Alert.alert('Erreur de chargement', e.message);
    } finally {
      setChargementGlobal(false);
      setEtapeChargement('');
    }
  };

  // ─── CHAT IA ────────────────────────────────────────────────────────────────

  const ajouterMessageSystem = (texte: string) => {
    setMessagesChat(prev => [...prev, {
      id: Date.now().toString(),
      role: 'ia',
      texte,
      timestamp: new Date()
    }]);
  };

  // Envoie la consigne, appelle Gemini, affiche la réponse dans le chat
  const gererEnvoiConsigne = async () => {
    const texte = saisieConsigne.trim();
    if (!texte) return;

    if (fichiersCharges.length === 0) {
      Alert.alert('Aucun fichier chargé', 'Allez sur l\'onglet Projet, sélectionnez des fichiers et chargez-les d\'abord.');
      return;
    }

    // Ajouter le message utilisateur dans le chat
    const msgUser: MessageChat = {
      id: Date.now().toString(),
      role: 'user',
      texte,
      timestamp: new Date()
    };
    setMessagesChat(prev => [...prev, msgUser]);
    setSaisieConsigne('');
    Keyboard.dismiss();

    setChargementIA(true);

    const cibles = fichiersCharges.filter(f => fichiersCiblesSelectionnes.includes(f.path));
    const contextes = fichiersCharges.filter(f => fichiersContexteSelectionnes.includes(f.path));

    try {
      const modifs = await modifierCodeAvecGemini(cleGemini, arborescence, cibles, contextes, texte);

      setModificationsIA(modifs);
      setFichierVisuActif(modifs[0]?.path || '');
      setModeVisu('modifie');

      // Résumé lisible de ce que l'IA a fait
      const resumeIA = modifs.map(m =>
        `${m.action === 'CREATE' ? '🆕 Créé' : '✏️ Modifié'} : \`${m.path}\``
      ).join('\n');

      setMessagesChat(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'ia',
        texte: `J'ai effectué ${modifs.length} modification(s) :\n\n${resumeIA}\n\nVisualisez le code dans l'onglet **Projet** puis validez pour pousser sur GitHub.`,
        timestamp: new Date()
      }]);
    } catch (e: any) {
      setMessagesChat(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'ia',
        texte: `❌ Erreur : ${e.message || 'Impossible de traiter la demande.'}`,
        timestamp: new Date()
      }]);
    } finally {
      setChargementIA(false);
    }
  };

  // ─── COMMIT + PR ────────────────────────────────────────────────────────────

  const gererSoumissionGitHub = async () => {
    if (modificationsIA.length === 0) {
      Alert.alert('Rien à commiter', 'Demandez d\'abord une modification à l\'IA.');
      return;
    }
    setChargementGlobal(true);
    setEtapeChargement('Création de la branche...');

    const ts = Math.floor(Date.now() / 1000);
    const nouvelleBranche = `feature/remote-ia-${ts}`;

    try {
      await creerNouvelleBranche(tokenGithub, proprietaire, nomDepot, brancheCible, nouvelleBranche);
      setEtapeChargement('Commit atomique multi-fichiers...');
      await commiterPlusieursFichiers(
        tokenGithub, proprietaire, nomDepot,
        modificationsIA.map(m => ({ path: m.path, content: m.content })),
        nouvelleBranche,
        `[IA Remote] ${modificationsIA.length} fichier(s) modifié(s)`
      );
      setEtapeChargement('Ouverture de la Pull Request...');
      const prUrl = await creerPullRequest(
        tokenGithub, proprietaire, nomDepot,
        `[IA] Modifie ${modificationsIA.length} fichier(s)`,
        `Modifications via Télécommandeur de Code IA.\n\n**Fichiers :** ${modificationsIA.map(m => `\`${m.path}\``).join(', ')}`,
        nouvelleBranche, brancheCible
      );
      setUrlPullRequest(prUrl);
      setBrancheDerniereSoumission(nouvelleBranche);
      setOngletActif('ci');
      ajouterMessageSystem(`🚀 Modifications poussées sur \`${nouvelleBranche}\`. Allez sur l\'onglet CI/CD pour lancer les tests !`);
    } catch (e: any) {
      Alert.alert('Erreur de validation', e.message);
    } finally {
      setChargementGlobal(false);
      setEtapeChargement('');
    }
  };

  // ─── CI / CD ────────────────────────────────────────────────────────────────

  const gererDeclenchementCI = async () => {
    if (!brancheDerniereSoumission || !workflowSelectionne) return;
    setChargementGlobal(true);
    setEtapeChargement('Déclenchement du workflow...');
    setLogsErreurCI('');
    setDerniereExecution(null);
    try {
      await declencherWorkflow(tokenGithub, proprietaire, nomDepot, workflowSelectionne, brancheDerniereSoumission);
      setChargementGlobal(false);
      setEtapeChargement('');
      lancerSurveillanceCI();
    } catch (e: any) {
      Alert.alert('Erreur', e.message);
      setChargementGlobal(false);
      setEtapeChargement('');
    }
  };

  const lancerSurveillanceCI = () => {
    if (intervalleSurveillance.current) clearInterval(intervalleSurveillance.current);
    setSurveillanceActive(true);
    verifierStatutCI();
    intervalleSurveillance.current = setInterval(verifierStatutCI, 6000);
  };

  const verifierStatutCI = async () => {
    const run = await recupererDerniereExecutionBranche(tokenGithub, proprietaire, nomDepot, brancheDerniereSoumission);
    if (!run) return;
    setDerniereExecution(run);
    if (run.status === 'completed') {
      if (intervalleSurveillance.current) clearInterval(intervalleSurveillance.current);
      setSurveillanceActive(false);
      if (run.conclusion === 'failure') {
        const logs = await recupererLogsErreurJob(tokenGithub, proprietaire, nomDepot, run.id);
        setLogsErreurCI(logs);
      }
    }
  };

  const gererAutoCorrection = () => {
    if (!logsErreurCI) return;
    setSaisieConsigne(`Le build a échoué. Voici le rapport d'erreur :\n---\n${logsErreurCI}\n---\nCorrige le code pour résoudre ce problème.`);
    setLogsErreurCI('');
    setDerniereExecution(null);
    setOngletActif('chat');
  };

  // ─── HELPERS ────────────────────────────────────────────────────────────────

  const alternerCible = (chemin: string) => {
    setFichiersCiblesSelectionnes(prev =>
      prev.includes(chemin) ? prev.filter(p => p !== chemin) : [...prev, chemin]
    );
    setFichiersContexteSelectionnes(prev => prev.filter(p => p !== chemin));
  };

  const alternerContexte = (chemin: string) => {
    setFichiersContexteSelectionnes(prev =>
      prev.includes(chemin) ? prev.filter(p => p !== chemin) : [...prev, chemin]
    );
    setFichiersCiblesSelectionnes(prev => prev.filter(p => p !== chemin));
  };

  const obtenirCodeOriginal = (chemin: string) =>
    fichiersCharges.find(x => x.path === chemin)?.content || '// Fichier non chargé';

  const obtenirCodeModifie = (chemin: string) =>
    modificationsIA.find(x => x.path === chemin)?.content || obtenirCodeOriginal(chemin);

  const arborescenceFiltrée = arborescence.filter(c =>
    c.toLowerCase().includes(texteFiltreRecherche.toLowerCase())
  );

  const totalSelectionnes = fichiersCiblesSelectionnes.length + fichiersContexteSelectionnes.length;

  // ─── RENDU ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#07080F" />

      {/* ── Modal de Configuration ── */}
      {afficherConfig && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalConfig}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.modalConfigContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalConfigEntete}>
                <Text style={styles.modalTitre}>⚙️ Configuration</Text>
                <TouchableOpacity onPress={() => setAfficherConfig(false)} style={styles.boutonFermer}>
                  <Text style={styles.boutonFermerTexte}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.labelGroupe}>GEMINI</Text>
              <TextInput style={styles.inputConfig} placeholder="Clé API Gemini" placeholderTextColor="#3F4860"
                secureTextEntry value={cleGemini} onChangeText={setCleGemini} />

              <Text style={styles.labelGroupe}>GITHUB</Text>
              <TextInput style={styles.inputConfig} placeholder="Personal Access Token" placeholderTextColor="#3F4860"
                secureTextEntry value={tokenGithub} onChangeText={setTokenGithub} />
              <View style={styles.rangeeDoubleInput}>
                <TextInput style={[styles.inputConfig, { flex: 1, marginRight: 8 }]} placeholder="Utilisateur"
                  placeholderTextColor="#3F4860" value={proprietaire} onChangeText={setProprietaire} />
                <TextInput style={[styles.inputConfig, { flex: 1 }]} placeholder="Dépôt"
                  placeholderTextColor="#3F4860" value={nomDepot} onChangeText={setNomDepot} />
              </View>
              <TextInput style={styles.inputConfig} placeholder="Branche (ex: main)"
                placeholderTextColor="#3F4860" value={brancheCible} onChangeText={setBrancheCible} />

              <TouchableOpacity style={styles.boutonPrimaire} onPress={sauvegarderConfiguration}>
                <Text style={styles.boutonPrimaireTexte}>💾 Sauvegarder</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      )}

      {/* ── Écran Principal ── */}
      <View style={styles.conteneur}>

        {/* En-tête global de l'app */}
        <View style={styles.enTete}>
          <View style={styles.enTeteGauche}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoEmoji}>🤖</Text>
            </View>
            <View>
              <Text style={styles.titreEnTete}>IA Code Remote</Text>
              <Text style={styles.sousTitreEnTete}>
                {proprietaire && nomDepot ? `${proprietaire}/${nomDepot}` : 'Non configuré'}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.boutonConfigEnTete} onPress={() => setAfficherConfig(true)}>
            <Text style={styles.iconConfig}>⚙️</Text>
          </TouchableOpacity>
        </View>

        {/* ── Corps : basculement d'onglet ── */}
        <View style={styles.corps}>
          {ongletActif === 'projet' && (
            <EcranProjet
              arborescence={arborescenceFiltrée}
              totalArborescence={arborescence.length}
              texteFiltreRecherche={texteFiltreRecherche}
              setTexteFiltreRecherche={setTexteFiltreRecherche}
              fichiersCiblesSelectionnes={fichiersCiblesSelectionnes}
              fichiersContexteSelectionnes={fichiersContexteSelectionnes}
              alternerCible={alternerCible}
              alternerContexte={alternerContexte}
              totalSelectionnes={totalSelectionnes}
              fichiersCharges={fichiersCharges}
              modificationsIA={modificationsIA}
              fichierVisuActif={fichierVisuActif}
              setFichierVisuActif={setFichierVisuActif}
              modeVisu={modeVisu}
              setModeVisu={setModeVisu}
              obtenirCodeOriginal={obtenirCodeOriginal}
              obtenirCodeModifie={obtenirCodeModifie}
              gererChargementArborescence={gererChargementArborescence}
              gererChargementFichiers={gererChargementFichiers}
              gererSoumissionGitHub={gererSoumissionGitHub}
              urlPullRequest={urlPullRequest}
              modificationsCount={modificationsIA.length}
            />
          )}

          {ongletActif === 'chat' && (
            <EcranChat
              messages={messagesChat}
              saisie={saisieConsigne}
              setSaisie={setSaisieConsigne}
              onEnvoyer={gererEnvoiConsigne}
              chargement={chargementIA}
              fichiersCharges={fichiersCharges.length}
              fichiersCibles={fichiersCiblesSelectionnes.length}
              scrollRef={scrollChatRef}
            />
          )}

          {ongletActif === 'ci' && (
            <EcranCI
              brancheSoumission={brancheDerniereSoumission}
              workflows={workflows}
              workflowSelectionne={workflowSelectionne}
              setWorkflowSelectionne={setWorkflowSelectionne}
              derniereExecution={derniereExecution}
              surveillanceActive={surveillanceActive}
              logsErreurCI={logsErreurCI}
              urlPullRequest={urlPullRequest}
              onDeclencher={gererDeclenchementCI}
              onAutoCorrection={gererAutoCorrection}
              onOuvrirPR={() => urlPullRequest && Linking.openURL(urlPullRequest)}
              onOuvrirRun={() => derniereExecution && Linking.openURL(derniereExecution.html_url)}
            />
          )}
        </View>

        {/* ── Barre d'onglets en bas ── */}
        <View style={styles.barreOnglets}>
          <TouchableOpacity
            style={[styles.boutonOnglet, ongletActif === 'projet' && styles.boutonOngletActif]}
            onPress={() => setOngletActif('projet')}
          >
            <Text style={styles.ongletEmoji}>📁</Text>
            <Text style={[styles.ongletLabel, ongletActif === 'projet' && styles.ongletLabelActif]}>Projet</Text>
            {totalSelectionnes > 0 && (
              <View style={styles.badgeOnglet}>
                <Text style={styles.badgeOngletTexte}>{totalSelectionnes}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.boutonOnglet, ongletActif === 'chat' && styles.boutonOngletActif]}
            onPress={() => setOngletActif('chat')}
          >
            <Text style={styles.ongletEmoji}>💬</Text>
            <Text style={[styles.ongletLabel, ongletActif === 'chat' && styles.ongletLabelActif]}>Chat IA</Text>
            {modificationsIA.length > 0 && (
              <View style={[styles.badgeOnglet, { backgroundColor: '#10B981' }]}>
                <Text style={styles.badgeOngletTexte}>{modificationsIA.length}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.boutonOnglet, ongletActif === 'ci' && styles.boutonOngletActif]}
            onPress={() => setOngletActif('ci')}
          >
            <Text style={styles.ongletEmoji}>🚦</Text>
            <Text style={[styles.ongletLabel, ongletActif === 'ci' && styles.ongletLabelActif]}>CI/CD</Text>
            {derniereExecution?.conclusion === 'failure' && (
              <View style={[styles.badgeOnglet, { backgroundColor: '#EF4444' }]}>
                <Text style={styles.badgeOngletTexte}>!</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Overlay de chargement global */}
      {chargementGlobal && (
        <View style={styles.overlayChargement}>
          <View style={styles.carteChargement}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.texteChargement}>{etapeChargement}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── ÉCRAN PROJET ────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function EcranProjet({
  arborescence, totalArborescence, texteFiltreRecherche, setTexteFiltreRecherche,
  fichiersCiblesSelectionnes, fichiersContexteSelectionnes,
  alternerCible, alternerContexte, totalSelectionnes,
  fichiersCharges, modificationsIA, fichierVisuActif, setFichierVisuActif,
  modeVisu, setModeVisu, obtenirCodeOriginal, obtenirCodeModifie,
  gererChargementArborescence, gererChargementFichiers, gererSoumissionGitHub,
  urlPullRequest, modificationsCount
}: any) {
  // Deux sous-vues : Explorateur OU Éditeur
  const voirEditeur = fichiersCharges.length > 0;

  if (!voirEditeur) {
    return (
      <View style={styles.ecranContenu}>
        {/* Bandeau de fichiers chargés */}
        <View style={styles.bandeauAction}>
          <TouchableOpacity style={styles.boutonBandeau} onPress={gererChargementArborescence}>
            <Text style={styles.boutonBandeauTexte}>🔍 Charger le dépôt</Text>
          </TouchableOpacity>
          {totalSelectionnes > 0 && (
            <TouchableOpacity style={[styles.boutonBandeau, styles.boutonBandeauVert]} onPress={gererChargementFichiers}>
              <Text style={styles.boutonBandeauTexte}>📥 Charger ({totalSelectionnes} fichiers)</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Synthèse de sélection */}
        {(fichiersCiblesSelectionnes.length > 0 || fichiersContexteSelectionnes.length > 0) && (
          <View style={styles.bandeauSynthese}>
            <Text style={styles.bandeauSyntheseTexte}>
              🎯 <Text style={{ color: '#10B981', fontWeight: '700' }}>{fichiersCiblesSelectionnes.length}</Text> cible(s)
              &nbsp;·&nbsp;
              👁️ <Text style={{ color: '#6366F1', fontWeight: '700' }}>{fichiersContexteSelectionnes.length}</Text> contexte(s)
            </Text>
          </View>
        )}

        {/* Barre de recherche */}
        {totalArborescence > 0 && (
          <View style={styles.barreRecherche}>
            <Text style={styles.iconeRecherche}>🔍</Text>
            <TextInput
              style={styles.inputRecherche}
              placeholder="Filtrer les fichiers..."
              placeholderTextColor="#3F4860"
              value={texteFiltreRecherche}
              onChangeText={setTexteFiltreRecherche}
            />
            {texteFiltreRecherche.length > 0 && (
              <TouchableOpacity onPress={() => setTexteFiltreRecherche('')}>
                <Text style={styles.boutonEffacerRecherche}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Liste des fichiers */}
        {totalArborescence > 0 ? (
          <ScrollView style={styles.listeFichiers} showsVerticalScrollIndicator={false}>
            {arborescence.map((chemin: string, index: number) => {
              const estCible = fichiersCiblesSelectionnes.includes(chemin);
              const estContexte = fichiersContexteSelectionnes.includes(chemin);
              const nomFichier = chemin.split('/').pop();
              const dossier = chemin.includes('/') ? chemin.split('/').slice(0, -1).join('/') : '';

              return (
                <View key={index} style={[
                  styles.ligneFichier,
                  estCible && styles.ligneFichierCible,
                  estContexte && styles.ligneFichierContexte,
                ]}>
                  <View style={styles.infoFichier}>
                    <Text style={styles.iconFichier}>
                      {estCible ? '🎯' : estContexte ? '👁️' : '📄'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.nomFichier,
                        estCible && { color: '#10B981' },
                        estContexte && { color: '#6366F1' }
                      ]} numberOfLines={1}>
                        {nomFichier}
                      </Text>
                      {dossier !== '' && (
                        <Text style={styles.cheminDossier} numberOfLines={1}>{dossier}/</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.actionsLigneFichier}>
                    <TouchableOpacity
                      style={[styles.pucheAction, estCible && styles.pucheActionCibleActif]}
                      onPress={() => alternerCible(chemin)}
                    >
                      <Text style={styles.pucheActionTexte}>🎯</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pucheAction, estContexte && styles.pucheActionContexteActif]}
                      onPress={() => alternerContexte(chemin)}
                    >
                      <Text style={styles.pucheActionTexte}>👁️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <View style={styles.etatVide}>
            <Text style={styles.etatVideEmoji}>🗂️</Text>
            <Text style={styles.etatVideTitre}>Aucun dépôt chargé</Text>
            <Text style={styles.etatVideSousTitre}>
              Commencez par configurer vos accès GitHub puis cliquez sur "Charger le dépôt"
            </Text>
          </View>
        )}
      </View>
    );
  }

  // ── Éditeur de code ──
  const tousFichiersPourVisu = modificationsIA.length > 0
    ? modificationsIA.map((m: ModificationFichier) => m.path)
    : fichiersCharges.filter((f: any) => fichiersCiblesSelectionnes.includes(f.path)).map((f: any) => f.path);

  return (
    <View style={styles.ecranContenu}>
      {/* Barre d'outils fichiers chargés */}
      <View style={styles.barreOutils}>
        <TouchableOpacity
          style={styles.boutonBarreOutils}
          onPress={() => {
            setFichierVisuActif('');
            setModeVisu('original');
          }}
        >
          <Text style={styles.boutonBarreOutilsTexte}>← Fichiers</Text>
        </TouchableOpacity>

        <View style={styles.badgesMode}>
          <TouchableOpacity
            style={[styles.badgeMode, modeVisu === 'original' && styles.badgeModeActif]}
            onPress={() => setModeVisu('original')}
          >
            <Text style={[styles.badgeModeTexte, modeVisu === 'original' && styles.badgeModeTexteActif]}>Original</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.badgeMode, modeVisu === 'modifie' && styles.badgeModeActifVert, modificationsIA.length === 0 && { opacity: 0.3 }]}
            disabled={modificationsIA.length === 0}
            onPress={() => setModeVisu('modifie')}
          >
            <Text style={[styles.badgeModeTexte, modeVisu === 'modifie' && { color: '#10B981' }]}>Modifié ✨</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sélecteur de fichier horizontal */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollSelecteurFichier}>
        {tousFichiersPourVisu.map((chemin: string, i: number) => (
          <TouchableOpacity
            key={i}
            style={[styles.pucheSelecteurFichier, fichierVisuActif === chemin && styles.pucheSelecteurFichierActif]}
            onPress={() => setFichierVisuActif(chemin)}
          >
            <Text style={[styles.pucheSelecteurFichierTexte, fichierVisuActif === chemin && { color: '#F8FAFC' }]}>
              {chemin.split('/').pop()}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Zone de code */}
      <ScrollView style={styles.zoneCode} horizontal>
        <ScrollView>
          <Text style={styles.codeMonospace}>
            {modeVisu === 'original'
              ? obtenirCodeOriginal(fichierVisuActif)
              : obtenirCodeModifie(fichierVisuActif)}
          </Text>
        </ScrollView>
      </ScrollView>

      {/* Bouton de validation */}
      {modificationsCount > 0 && (
        <TouchableOpacity style={styles.boutonCommit} onPress={gererSoumissionGitHub}>
          <Text style={styles.boutonCommitTexte}>🚀 Commiter {modificationsCount} fichier(s) sur GitHub</Text>
        </TouchableOpacity>
      )}

      {urlPullRequest !== '' && (
        <TouchableOpacity
          style={styles.boutonPR}
          onPress={() => Linking.openURL(urlPullRequest)}
        >
          <Text style={styles.boutonPRTexte}>🔗 Voir la Pull Request</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── ÉCRAN CHAT ──────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function EcranChat({ messages, saisie, setSaisie, onEnvoyer, chargement, fichiersCharges, fichiersCibles, scrollRef }: any) {
  return (
    // KeyboardAvoidingView ici pour que la zone de saisie remonte avec le clavier
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Bandeau d'état de chargement des fichiers */}
      {fichiersCharges === 0 ? (
        <View style={styles.bandeauAvertissement}>
          <Text style={styles.bandeauAvertissementTexte}>
            ⚠️ Aucun fichier chargé — allez sur l'onglet Projet pour en sélectionner.
          </Text>
        </View>
      ) : (
        <View style={styles.bandeauInfo}>
          <Text style={styles.bandeauInfoTexte}>
            📁 <Text style={{ fontWeight: '700', color: '#F8FAFC' }}>{fichiersCharges}</Text> fichier(s) chargé(s) ·
            🎯 <Text style={{ fontWeight: '700', color: '#10B981' }}>{fichiersCibles}</Text> cible(s)
          </Text>
        </View>
      )}

      {/* Historique du chat — scroll automatique vers le bas */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollChat}
        contentContainerStyle={styles.contentScrollChat}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 ? (
          <View style={styles.etatVideChat}>
            <Text style={styles.etatVideEmoji}>💬</Text>
            <Text style={styles.etatVideTitre}>Prêt à coder</Text>
            <Text style={styles.etatVideSousTitre}>
              Chargez des fichiers depuis le dépôt, puis décrivez les modifications que vous souhaitez.
            </Text>
          </View>
        ) : (
          messages.map((msg: MessageChat) => (
            <View
              key={msg.id}
              style={[
                styles.bulleChat,
                msg.role === 'user' ? styles.bulleChatUser : styles.bulleChatIA
              ]}
            >
              {msg.role === 'ia' && (
                <Text style={styles.avatarIA}>🤖</Text>
              )}
              <View style={[
                styles.contentenBulle,
                msg.role === 'user' ? styles.contentenBulleUser : styles.contentenBulleIA
              ]}>
                <Text style={[
                  styles.texteMessage,
                  msg.role === 'user' ? styles.texteMessageUser : styles.texteMessageIA
                ]}>
                  {msg.texte}
                </Text>
                <Text style={styles.timestampMessage}>
                  {msg.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          ))
        )}
        {chargement && (
          <View style={[styles.bulleChat, styles.bulleChatIA]}>
            <Text style={styles.avatarIA}>🤖</Text>
            <View style={styles.indicateurTyping}>
              <ActivityIndicator size="small" color="#6366F1" />
              <Text style={styles.texteTyping}>Gemini analyse votre projet...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Zone de saisie — toujours visible au dessus du clavier */}
      <View style={styles.zoneInputChat}>
        <TextInput
          style={styles.inputChat}
          placeholder="Décrivez la modification souhaitée..."
          placeholderTextColor="#3F4860"
          value={saisie}
          onChangeText={setSaisie}
          multiline
          maxHeight={100}
          returnKeyType="default"
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.boutonEnvoyer, (!saisie.trim() || chargement) && styles.boutonEnvoyerDesactive]}
          onPress={onEnvoyer}
          disabled={!saisie.trim() || chargement}
        >
          <Text style={styles.boutonEnvoyerTexte}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── ÉCRAN CI/CD ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function EcranCI({
  brancheSoumission, workflows, workflowSelectionne, setWorkflowSelectionne,
  derniereExecution, surveillanceActive, logsErreurCI, urlPullRequest,
  onDeclencher, onAutoCorrection, onOuvrirPR, onOuvrirRun
}: any) {
  const getCouleurStatut = () => {
    if (!derniereExecution) return '#1E293B';
    if (surveillanceActive || derniereExecution.status !== 'completed') return '#92400E';
    if (derniereExecution.conclusion === 'success') return '#14532D';
    return '#7F1D1D';
  };

  const getIconeStatut = () => {
    if (!derniereExecution) return '⏳';
    if (surveillanceActive || derniereExecution.status !== 'completed') return '🟡';
    if (derniereExecution.conclusion === 'success') return '🟢';
    return '🔴';
  };

  const getTexteStatut = () => {
    if (!derniereExecution) return 'En attente de déclenchement';
    if (derniereExecution.status === 'queued') return 'En file d\'attente...';
    if (derniereExecution.status === 'in_progress') return 'Tests en cours de traitement...';
    if (derniereExecution.conclusion === 'success') return 'Tous les tests passent ✅';
    if (derniereExecution.conclusion === 'failure') return 'Échec du build ❌';
    return `Terminé : ${derniereExecution.conclusion}`;
  };

  return (
    <ScrollView style={styles.ecranContenu} contentContainerStyle={{ padding: 16 }}>
      {!brancheSoumission ? (
        <View style={styles.etatVide}>
          <Text style={styles.etatVideEmoji}>🚦</Text>
          <Text style={styles.etatVideTitre}>Aucune branche poussée</Text>
          <Text style={styles.etatVideSousTitre}>
            Demandez une modification à l'IA, prévisualisez-la dans le Projet et commitez d'abord.
          </Text>
        </View>
      ) : (
        <>
          {/* Branche ciblée */}
          <View style={styles.carteCI}>
            <Text style={styles.labelCarteCI}>Branche testée</Text>
            <Text style={styles.valeurCarteCI}>🌿 {brancheSoumission}</Text>
          </View>

          {/* Statut */}
          <View style={[styles.carteStatutCI, { backgroundColor: getCouleurStatut() }]}>
            <View style={styles.ligneStatutCI}>
              <Text style={styles.iconStatutCI}>{getIconeStatut()}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.texteStatutCI}>{getTexteStatut()}</Text>
                {derniereExecution?.name && (
                  <Text style={styles.nomWorkflowCI}>{derniereExecution.name}</Text>
                )}
              </View>
              {(surveillanceActive || (derniereExecution && derniereExecution.status !== 'completed')) && (
                <ActivityIndicator size="small" color="#FCD34D" />
              )}
            </View>
            {derniereExecution && (
              <TouchableOpacity style={styles.lienCI} onPress={onOuvrirRun}>
                <Text style={styles.lienCITexte}>Voir l'exécution sur GitHub →</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Sélecteur de workflow + Bouton Run */}
          {!surveillanceActive && (
            <View style={styles.carteCI}>
              <Text style={styles.labelCarteCI}>Workflow à exécuter</Text>
              {workflows.length === 0 ? (
                <Text style={styles.texteAucunWorkflow}>Aucun workflow détecté dans ce dépôt (.github/workflows/)</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
                  {workflows.map((w: any, i: number) => (
                    <TouchableOpacity
                      key={i}
                      style={[styles.pucheWorkflow, workflowSelectionne === w.id && styles.pucheWorkflowActif]}
                      onPress={() => setWorkflowSelectionne(w.id)}
                    >
                      <Text style={styles.pucheWorkflowTexte}>{w.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TouchableOpacity
                style={[styles.boutonRunCI, workflows.length === 0 && { opacity: 0.4 }]}
                onPress={onDeclencher}
                disabled={workflows.length === 0}
              >
                <Text style={styles.boutonRunCITexte}>🚀 Lancer les tests à distance</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Logs d'erreurs et auto-correction */}
          {logsErreurCI !== '' && (
            <View style={styles.carteErreurCI}>
              <Text style={styles.titreCarte}>🔍 Rapport d'erreurs</Text>
              <ScrollView style={styles.zoneLogs} nestedScrollEnabled>
                <Text style={styles.texteLogs}>{logsErreurCI}</Text>
              </ScrollView>
              <TouchableOpacity style={styles.boutonAutoCorrection} onPress={onAutoCorrection}>
                <Text style={styles.boutonAutoCorrectionTexte}>🔧 Injecter dans Gemini et corriger</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* PR */}
          {urlPullRequest !== '' && (
            <TouchableOpacity style={styles.boutonPR} onPress={onOuvrirPR}>
              <Text style={styles.boutonPRTexte}>🔗 Voir la Pull Request sur GitHub</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── STYLES ──────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg0: '#07080F',
  bg1: '#0D0F1C',
  bg2: '#12162B',
  surface: '#161B30',
  surfaceRaised: '#1D2340',
  border: '#252A45',
  accent: '#6366F1',
  accentMuted: '#2D2F6A',
  vert: '#10B981',
  vertMuted: '#0A3D2E',
  rouge: '#EF4444',
  rougeMuted: '#3D0A0A',
  jaune: '#F59E0B',
  texte: '#F8FAFC',
  texteMuted: '#6B7599',
  texteSubtle: '#3F4860',
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg0 },
  conteneur: { flex: 1, backgroundColor: C.bg0 },

  // ── Modal de Configuration
  modalConfig: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: C.bg0, zIndex: 1000
  },
  modalConfigContent: { padding: 20, paddingBottom: 40 },
  modalConfigEntete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitre: { fontSize: 20, fontWeight: '800', color: C.texte },
  boutonFermer: { width: 32, height: 32, backgroundColor: C.surface, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  boutonFermerTexte: { color: C.texteMuted, fontSize: 14, fontWeight: '700' },
  labelGroupe: { color: C.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 20, marginBottom: 8 },
  inputConfig: {
    backgroundColor: C.surface, color: C.texte, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border,
    fontSize: 14, marginBottom: 10
  },
  rangeeDoubleInput: { flexDirection: 'row' },

  // ── En-tête
  enTete: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: C.bg1, borderBottomWidth: 1, borderBottomColor: C.border
  },
  enTeteGauche: { flexDirection: 'row', alignItems: 'center' },
  logoBadge: {
    width: 36, height: 36, backgroundColor: C.accentMuted,
    borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10
  },
  logoEmoji: { fontSize: 18 },
  titreEnTete: { fontSize: 16, fontWeight: '800', color: C.texte },
  sousTitreEnTete: { fontSize: 11, color: C.texteMuted, marginTop: 1 },
  boutonConfigEnTete: {
    width: 36, height: 36, backgroundColor: C.surface, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border
  },
  iconConfig: { fontSize: 16 },

  // ── Corps + Barre d'onglets
  corps: { flex: 1 },
  barreOnglets: {
    flexDirection: 'row', backgroundColor: C.bg1,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingBottom: 4
  },
  boutonOnglet: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    position: 'relative'
  },
  boutonOngletActif: { borderTopWidth: 2, borderTopColor: C.accent },
  ongletEmoji: { fontSize: 20 },
  ongletLabel: { fontSize: 10, color: C.texteMuted, fontWeight: '600', marginTop: 2 },
  ongletLabelActif: { color: C.accent },
  badgeOnglet: {
    position: 'absolute', top: 6, right: 16,
    backgroundColor: C.accent, borderRadius: 8,
    minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 3
  },
  badgeOngletTexte: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },

  // ── Contenu des écrans
  ecranContenu: { flex: 1 },

  // ── Bandeau
  bandeauAction: {
    flexDirection: 'row', padding: 12, gap: 8,
    backgroundColor: C.bg1, borderBottomWidth: 1, borderBottomColor: C.border
  },
  bandeauSynthese: {
    backgroundColor: C.accentMuted, paddingVertical: 6, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: C.border
  },
  bandeauSyntheseTexte: { color: C.texteMuted, fontSize: 12 },
  boutonBandeau: {
    flex: 1, backgroundColor: C.surface, paddingVertical: 10, borderRadius: 8,
    alignItems: 'center', borderWidth: 1, borderColor: C.border
  },
  boutonBandeauVert: { backgroundColor: C.vertMuted, borderColor: C.vert },
  boutonBandeauTexte: { color: C.texte, fontSize: 12, fontWeight: '700' },

  // ── Barre de recherche
  barreRecherche: {
    flexDirection: 'row', alignItems: 'center',
    margin: 12, backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 12, borderWidth: 1, borderColor: C.border
  },
  iconeRecherche: { fontSize: 14, marginRight: 8 },
  inputRecherche: { flex: 1, color: C.texte, fontSize: 13, paddingVertical: 10 },
  boutonEffacerRecherche: { color: C.texteMuted, fontSize: 16, paddingLeft: 8 },

  // ── Liste de fichiers
  listeFichiers: { flex: 1, paddingHorizontal: 12 },
  ligneFichier: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 10, marginBottom: 6,
    paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.border
  },
  ligneFichierCible: { borderColor: C.vert, backgroundColor: C.vertMuted },
  ligneFichierContexte: { borderColor: C.accent, backgroundColor: C.accentMuted },
  infoFichier: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconFichier: { fontSize: 16, marginRight: 10 },
  nomFichier: { color: C.texte, fontSize: 13, fontWeight: '600' },
  cheminDossier: { color: C.texteMuted, fontSize: 10, marginTop: 1 },
  actionsLigneFichier: { flexDirection: 'row', gap: 6 },
  pucheAction: {
    width: 32, height: 32, backgroundColor: C.surfaceRaised, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border
  },
  pucheActionCibleActif: { backgroundColor: C.vert, borderColor: C.vert },
  pucheActionContexteActif: { backgroundColor: C.accent, borderColor: C.accent },
  pucheActionTexte: { fontSize: 14 },

  // ── État vide
  etatVide: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  etatVideEmoji: { fontSize: 48, marginBottom: 16 },
  etatVideTitre: { fontSize: 18, fontWeight: '800', color: C.texte, marginBottom: 8, textAlign: 'center' },
  etatVideSousTitre: { fontSize: 13, color: C.texteMuted, textAlign: 'center', lineHeight: 20 },

  // ── Éditeur de code
  barreOutils: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: C.bg1, borderBottomWidth: 1, borderBottomColor: C.border
  },
  boutonBarreOutils: {
    paddingVertical: 6, paddingHorizontal: 12, backgroundColor: C.surface,
    borderRadius: 8, borderWidth: 1, borderColor: C.border
  },
  boutonBarreOutilsTexte: { color: C.accent, fontSize: 12, fontWeight: '700' },
  badgesMode: { flexDirection: 'row', gap: 6 },
  badgeMode: {
    paddingVertical: 5, paddingHorizontal: 10, backgroundColor: C.surface,
    borderRadius: 8, borderWidth: 1, borderColor: C.border
  },
  badgeModeActif: { backgroundColor: C.accentMuted, borderColor: C.accent },
  badgeModeActifVert: { backgroundColor: C.vertMuted, borderColor: C.vert },
  badgeModeTexte: { color: C.texteMuted, fontSize: 11, fontWeight: '700' },
  badgeModeTexteActif: { color: C.accent },
  scrollSelecteurFichier: { paddingVertical: 8, paddingHorizontal: 12, maxHeight: 48 },
  pucheSelecteurFichier: {
    paddingVertical: 5, paddingHorizontal: 12, backgroundColor: C.surface,
    borderRadius: 8, marginRight: 6, borderWidth: 1, borderColor: C.border
  },
  pucheSelecteurFichierActif: { backgroundColor: C.accentMuted, borderColor: C.accent },
  pucheSelecteurFichierTexte: { color: C.texteMuted, fontSize: 11, fontWeight: '600' },
  zoneCode: {
    flex: 1, margin: 12, backgroundColor: C.bg0,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12
  },
  codeMonospace: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11, color: '#10B981', lineHeight: 18
  },
  boutonCommit: {
    marginHorizontal: 12, marginTop: 8, backgroundColor: C.accent,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center'
  },
  boutonCommitTexte: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  boutonPR: {
    marginHorizontal: 12, marginTop: 8, marginBottom: 12,
    backgroundColor: C.vertMuted, paddingVertical: 12,
    borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: C.vert
  },
  boutonPRTexte: { color: C.vert, fontWeight: '700', fontSize: 13 },

  // ── Chat
  bandeauAvertissement: {
    backgroundColor: '#3D2A00', paddingVertical: 8, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#7A5200'
  },
  bandeauAvertissementTexte: { color: C.jaune, fontSize: 12, fontWeight: '600' },
  bandeauInfo: {
    backgroundColor: C.accentMuted, paddingVertical: 7, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: C.border
  },
  bandeauInfoTexte: { color: C.texteMuted, fontSize: 12 },
  scrollChat: { flex: 1, backgroundColor: C.bg0 },
  contentScrollChat: { padding: 16, paddingBottom: 8 },
  etatVideChat: { paddingTop: 60, alignItems: 'center', paddingHorizontal: 32 },
  bulleChat: { flexDirection: 'row', marginBottom: 16 },
  bulleChatIA: { alignItems: 'flex-start' },
  bulleChatUser: { justifyContent: 'flex-end' },
  avatarIA: { fontSize: 22, marginRight: 8, marginTop: 4 },
  contentenBulle: { maxWidth: '80%', borderRadius: 16, padding: 12 },
  contentenBulleIA: { backgroundColor: C.surface, borderTopLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  contentenBulleUser: { backgroundColor: C.accentMuted, borderTopRightRadius: 4, borderWidth: 1, borderColor: C.accent },
  texteMessage: { fontSize: 14, lineHeight: 20 },
  texteMessageIA: { color: C.texte },
  texteMessageUser: { color: C.texte },
  timestampMessage: { color: C.texteSubtle, fontSize: 10, marginTop: 6, textAlign: 'right' },
  indicateurTyping: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.border },
  texteTyping: { color: C.texteMuted, fontSize: 13, marginLeft: 10 },
  // Zone de saisie chat — collée au bas de l'écran, remonte avec le clavier
  zoneInputChat: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: C.bg1, borderTopWidth: 1, borderTopColor: C.border
  },
  inputChat: {
    flex: 1, backgroundColor: C.surface, color: C.texte, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14,
    borderWidth: 1, borderColor: C.border,
    maxHeight: 100, marginRight: 8
  },
  boutonEnvoyer: {
    width: 42, height: 42, backgroundColor: C.accent, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center'
  },
  boutonEnvoyerDesactive: { backgroundColor: C.border },
  boutonEnvoyerTexte: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', lineHeight: 20 },

  // ── CI/CD
  carteCI: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: C.border
  },
  labelCarteCI: { color: C.texteMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  valeurCarteCI: { color: C.texte, fontSize: 14, fontWeight: '700' },
  titreCarte: { color: C.texte, fontSize: 13, fontWeight: '700', marginBottom: 10 },
  carteStatutCI: {
    borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: 'transparent'
  },
  ligneStatutCI: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconStatutCI: { fontSize: 24 },
  texteStatutCI: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  nomWorkflowCI: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  lienCI: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  lienCITexte: { color: '#93C5FD', fontSize: 12 },
  texteAucunWorkflow: { color: C.texteMuted, fontSize: 12, fontStyle: 'italic', marginVertical: 8 },
  pucheWorkflow: {
    paddingVertical: 6, paddingHorizontal: 12, backgroundColor: C.surfaceRaised,
    borderRadius: 8, marginRight: 6, borderWidth: 1, borderColor: C.border
  },
  pucheWorkflowActif: { backgroundColor: C.accentMuted, borderColor: C.accent },
  pucheWorkflowTexte: { color: C.texte, fontSize: 11, fontWeight: '600' },
  boutonRunCI: {
    backgroundColor: C.accent, paddingVertical: 13, borderRadius: 12,
    alignItems: 'center', marginTop: 12
  },
  boutonRunCITexte: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  carteErreurCI: {
    backgroundColor: C.rougeMuted, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: C.rouge
  },
  zoneLogs: { maxHeight: 120, backgroundColor: '#0D0100', borderRadius: 8, padding: 10, marginBottom: 12 },
  texteLogs: {
    color: '#FCA5A5', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11, lineHeight: 16
  },
  boutonAutoCorrection: {
    backgroundColor: C.rouge, paddingVertical: 12, borderRadius: 10, alignItems: 'center'
  },
  boutonAutoCorrectionTexte: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },

  // ── Boutons généraux
  boutonPrimaire: {
    backgroundColor: C.accent, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', marginTop: 24
  },
  boutonPrimaireTexte: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  // ── Overlay chargement
  overlayChargement: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(7, 8, 15, 0.8)',
    justifyContent: 'center', alignItems: 'center', zIndex: 999
  },
  carteChargement: {
    backgroundColor: C.surfaceRaised, borderRadius: 20, padding: 28,
    alignItems: 'center', marginHorizontal: 40, borderWidth: 1, borderColor: C.border
  },
  texteChargement: { color: C.texte, marginTop: 14, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
