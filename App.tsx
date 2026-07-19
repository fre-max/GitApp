import React, { useState, useEffect } from 'react';
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

// Importation des fonctions de services mises à jour
import {
  recupererArborescence,
  recupererContenuFichiersEnParallele,
  creerNouvelleBranche,
  commiterFichier,
  creerPullRequest
} from './src/services/github';
import { modifierCodeAvecGemini } from './src/services/gemini';

// Clés de stockage
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
  const [fichierCible, setFichierCible] = useState('');
  const [fichiersContexteSelectionnes, setFichiersContexteSelectionnes] = useState<string[]>([]);
  const [texteFiltreRecherche, setTexteFiltreRecherche] = useState('');

  // --- Contenus des fichiers chargés ---
  const [codeOriginal, setCodeOriginal] = useState('');
  const [shaOriginal, setShaOriginal] = useState('');
  const [contenusContexte, setContenusContexte] = useState<Array<{ path: string; content: string }>>([]);

  // --- États de l'application ---
  const [chargement, setChargement] = useState(false);
  const [etapeChargement, setEtapeChargement] = useState('');
  const [afficherConfig, setAfficherConfig] = useState(true);
  const [consigne, setConsigne] = useState('');
  const [codeModifie, setCodeModifie] = useState('');
  const [ongletActif, setOngletActif] = useState<'original' | 'modifie'>('original');
  const [urlPullRequest, setUrlPullRequest] = useState('');

  // Charge la configuration stockée au démarrage
  useEffect(() => {
    chargerConfiguration();
  }, []);

  // Charge la configuration et les sélections de fichiers précédentes
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
        setFichierCible(config.fichierCible || '');
        setFichiersContexteSelectionnes(config.fichiersContexteSelectionnes || []);
        console.log('✅ [App] Configuration chargée avec succès');
        
        // Si les infos de connexion sont là, on peut fermer la config
        if (config.tokenGithub && config.cleGemini && config.proprietaire && config.nomDepot) {
          setAfficherConfig(false);
        }
      }
    } catch (erreur) {
      console.error('❌ [App] Impossible de charger la configuration:', erreur);
    }
  };

  // Sauvegarde les paramètres de configuration dans AsyncStorage
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
        fichierCible,
        fichiersContexteSelectionnes
      };
      await AsyncStorage.setItem(CLE_STORAGE_CONFIG, JSON.stringify(config));
      Alert.alert('Succès', 'Configuration sauvegardée localement !');
    } catch (erreur) {
      console.error('❌ [App] Impossible de sauvegarder la configuration:', erreur);
      Alert.alert('Erreur', 'Impossible de sauvegarder les paramètres.');
    }
  };

  // 1️⃣ CHARGEMENT DE L'ARBORESCENCE DU PROJET
  // Récupère la liste de tous les fichiers du dépôt GitHub
  const gererChargementArborescence = async () => {
    if (!tokenGithub || !proprietaire || !nomDepot) {
      Alert.alert('Erreur', 'Veuillez remplir les informations d\'accès GitHub.');
      setAfficherConfig(true);
      return;
    }

    setChargement(true);
    setEtapeChargement('Récupération de l\'arborescence de fichiers...');
    setArborescence([]);

    try {
      const listeFichiers = await recupererArborescence(
        tokenGithub,
        proprietaire,
        nomDepot,
        brancheCible
      );
      setArborescence(listeFichiers);
      Alert.alert('Succès', `${listeFichiers.length} fichiers trouvés dans le dépôt !`);
    } catch (erreur: any) {
      Alert.alert('Erreur', erreur.message || 'Impossible de lire l\'arborescence.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 2️⃣ RÉCUPÉRATION DU CONTENU DU FICHIER CIBLE ET DES FICHIERS DE CONTEXTE EN PARALLÈLE
  // Appelle l'API REST de GitHub pour charger simultanément les codes sources
  const gererChargementContenuFichiers = async () => {
    if (!fichierCible) {
      Alert.alert('Erreur', 'Veuillez définir un fichier cible à modifier.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Téléchargement des fichiers en cours...');
    setCodeOriginal('');
    setCodeModifie('');
    setContenusContexte([]);
    setUrlPullRequest('');

    // On prépare la liste des fichiers uniques à charger (cible + contextes)
    const cheminsACharger = Array.from(
      new Set([fichierCible, ...fichiersContexteSelectionnes])
    );

    try {
      const fichiersCharges = await recupererContenuFichiersEnParallele(
        tokenGithub,
        proprietaire,
        nomDepot,
        cheminsACharger,
        brancheCible
      );

      // On isole le fichier cible
      const cible = fichiersCharges.find(f => f.path === fichierCible);
      if (cible) {
        setCodeOriginal(cible.content);
        setShaOriginal(cible.sha);
      }

      // On isole les fichiers de contexte
      const contextes = fichiersCharges.filter(f => f.path !== fichierCible);
      setContenusContexte(contextes);

      setOngletActif('original');
      Alert.alert(
        'Chargement réussi', 
        `Fichier cible et ${contextes.length} fichier(s) de contexte chargés avec succès.`
      );
    } catch (erreur: any) {
      Alert.alert('Erreur de chargement', erreur.message || 'Impossible de récupérer les contenus.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 3️⃣ ENVOI À GEMINI AVEC CONTEXTE MULTI-FICHIERS
  // Soumet le fichier cible + fichiers de contexte à Gemini pour modification
  const gererModificationCode = async () => {
    if (!cleGemini) {
      Alert.alert('Erreur', 'Veuillez renseigner votre clé API Gemini.');
      setAfficherConfig(true);
      return;
    }
    if (!codeOriginal) {
      Alert.alert('Erreur', 'Veuillez d\'abord charger le contenu du projet.');
      return;
    }
    if (!consigne.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir une consigne pour l\'IA.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Gemini révise le projet et modifie le code...');
    setCodeModifie('');

    try {
      const codeGenere = await modifierCodeAvecGemini(
        cleGemini,
        arborescence,
        { path: fichierCible, content: codeOriginal },
        contenusContexte,
        consigne
      );
      setCodeModifie(codeGenere);
      setOngletActif('modifie');
      Alert.alert('Succès', 'Code modifié reçu de Gemini !');
    } catch (erreur: any) {
      Alert.alert('Erreur de génération', erreur.message || 'Échec de la modification par Gemini.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 4️⃣ COMMITER ET OUVRIR UNE PR
  // Soumet le fichier modifié sur une nouvelle branche et crée la PR
  const gererSoumissionGitHub = async () => {
    if (!codeModifie) {
      Alert.alert('Erreur', 'Aucun code modifié disponible à pousser.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Création de la branche de feature...');
    
    const timestamp = Math.floor(Date.now() / 1000);
    const nomNouvelleBranche = `feature/remote-ia-${timestamp}`;
    const messageCommit = `[IA Code Remote] Modification de ${fichierCible}`;

    try {
      // Étape 4a : Création de la branche
      await creerNouvelleBranche(
        tokenGithub,
        proprietaire,
        nomDepot,
        brancheCible,
        nomNouvelleBranche
      );

      // Étape 4b : Push et commit du fichier modifié
      setEtapeChargement('Commit des modifications...');
      await commiterFichier(
        tokenGithub,
        proprietaire,
        nomDepot,
        fichierCible,
        codeModifie,
        shaOriginal,
        messageCommit,
        nomNouvelleBranche
      );

      // Étape 4c : Création de la Pull Request
      setEtapeChargement('Ouverture de la Pull Request...');
      const titrePR = `[IA] Modifie ${fichierCible.split('/').pop()}`;
      const descriptionPR = `Modifications appliquées via l'application mobile Télécommandeur de Code IA.\n\n**Fichier cible :** \`${fichierCible}\`\n\n**Consigne :**\n> ${consigne}\n\n**Fichiers lus pour contexte :**\n${
        fichiersContexteSelectionnes.map(f => `- \`${f}\``).join('\n') || '*Aucun*'
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
      Alert.alert(
        'Poussé avec succès ! 🎉',
        `La Pull Request a été ouverte pour la branche ${nomNouvelleBranche}.`
      );
    } catch (erreur: any) {
      Alert.alert('Erreur lors de la soumission', erreur.message || 'Impossible de valider les modifications.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // Définit un fichier comme la cible de la modification
  const definirCommeCible = (chemin: string) => {
    setFichierCible(chemin);
    // Un fichier cible ne peut pas être aussi un fichier de contexte, on l'exclut si besoin
    setFichiersContexteSelectionnes(prev => prev.filter(p => p !== chemin));
  };

  // Alterne l'état d'inclusion d'un fichier dans le contexte de Gemini
  const alternerContexte = (chemin: string) => {
    if (chemin === fichierCible) {
      Alert.alert('Action invalide', 'Le fichier cible ne peut pas servir de contexte en lecture seule.');
      return;
    }
    
    setFichiersContexteSelectionnes(prev => {
      if (prev.includes(chemin)) {
        return prev.filter(p => p !== chemin);
      } else {
        return [...prev, chemin];
      }
    });
  };

  // Ouvre l'URL de la Pull Request dans le navigateur mobile
  const gererOuverturePR = () => {
    if (urlPullRequest) {
      Linking.openURL(urlPullRequest);
    }
  };

  // Filtrage de la liste d'arborescence selon le champ recherche
  const arborescenceFiltrée = arborescence.filter(chemin =>
    chemin.toLowerCase().includes(texteFiltreRecherche.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.conteneurSafeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />
      <View style={styles.conteneur}>
        
        {/* En-tête */}
        <View style={styles.enTete}>
          <View>
            <Text style={styles.titreApp}>🤖 IA Code Remote</Text>
            <Text style={styles.sousTitreApp}>Multi-fichiers (Étape 1)</Text>
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

        {/* Panneau de Configuration (Pliable) */}
        {afficherConfig && (
          <ScrollView style={styles.zoneConfig} contentContainerStyle={styles.zoneConfigContent}>
            <Text style={styles.titreSection}>🔑 Paramètres de connexion</Text>
            
            <Text style={styles.labelInput}>Clé API Gemini</Text>
            <TextInput
              style={styles.input}
              placeholder="Clé API Google AI Studio"
              placeholderTextColor="#64748B"
              secureTextEntry
              value={cleGemini}
              onChangeText={setCleGemini}
            />

            <Text style={styles.labelInput}>GitHub Token (Classic ou Fine-grained)</Text>
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

        {/* Vue Principale */}
        {!afficherConfig && (
          <View style={styles.corpsPrincipal}>
            
            {/* Section Sélection d'Arborescence */}
            {arborescence.length > 0 && !codeOriginal && (
              <View style={styles.panneauArborescence}>
                <Text style={styles.titreSectionArbo}>📂 Sélectionnez vos fichiers :</Text>
                
                {/* Barre de Recherche */}
                <TextInput
                  style={styles.inputRecherche}
                  placeholder="Filtrer les fichiers du dépôt..."
                  placeholderTextColor="#64748B"
                  value={texteFiltreRecherche}
                  onChangeText={setTexteFiltreRecherche}
                />

                {/* Liste des fichiers */}
                <ScrollView style={styles.defilementFichiers}>
                  {arborescenceFiltrée.map((chemin, index) => {
                    const estCible = chemin === fichierCible;
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
                            onPress={() => definirCommeCible(chemin)}
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

                {/* Synthèse des sélections */}
                <View style={styles.panneauSelectionSynthese}>
                  <Text style={styles.texteSynthese}>
                    🎯 Cible : <Text style={styles.texteGras}>{fichierCible || 'Aucune (requis)'}</Text>
                  </Text>
                  <Text style={styles.texteSynthese}>
                    👁️ Contextes : <Text style={styles.texteGras}>{fichiersContexteSelectionnes.length} fichier(s)</Text>
                  </Text>
                  
                  <TouchableOpacity 
                    style={[styles.boutonChargerContenus, !fichierCible && styles.boutonDesactive]}
                    disabled={!fichierCible}
                    onPress={gererChargementContenuFichiers}
                  >
                    <Text style={styles.texteBoutonChargerContenus}>📥 Charger le contenu du projet</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Bouton pour réouvrir la sélection de fichiers s'ils sont chargés */}
            {codeOriginal !== '' && (
              <View style={styles.panneauFichiersPrets}>
                <View style={styles.panneauInfoFichierPret}>
                  <Text style={styles.texteInfoFichierPret} numberOfLines={1}>
                    🎯 Fichier Cible : <Text style={styles.texteGras}>{fichierCible}</Text>
                  </Text>
                  <Text style={styles.texteInfoFichierPret}>
                    👁️ Contextes lus : <Text style={styles.texteGras}>{fichiersContexteSelectionnes.length} fichier(s)</Text>
                  </Text>
                </View>
                <TouchableOpacity 
                  style={styles.boutonChangerFichiers} 
                  onPress={() => {
                    setCodeOriginal('');
                    setCodeModifie('');
                    setContenusContexte([]);
                  }}
                >
                  <Text style={styles.texteBoutonChangerFichiers}>🔄 Changer</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Si aucun fichier n'a été configuré ou chargé */}
            {arborescence.length === 0 && (
              <View style={styles.panneauVide}>
                <Text style={styles.texteVide}>Aucune arborescence chargée.</Text>
                <TouchableOpacity style={styles.boutonSauvegarder} onPress={() => setAfficherConfig(true)}>
                  <Text style={styles.texteBoutonSauvegarder}>⚙️ Ouvrir la configuration</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Éditeur de code et comparaison (Une fois les fichiers chargés) */}
            {codeOriginal !== '' && (
              <View style={styles.conteneurEdition}>
                
                {/* Onglets de prévisualisation */}
                <View style={styles.barreOnglets}>
                  <TouchableOpacity
                    style={[styles.onglet, ongletActif === 'original' && styles.ongletActif]}
                    onPress={() => setOngletActif('original')}
                  >
                    <Text style={[styles.texteOnglet, ongletActif === 'original' && styles.texteOngletActif]}>
                      Code Original ({fichierCible.split('/').pop()})
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.onglet, 
                      ongletActif === 'modifie' && styles.ongletActif,
                      !codeModifie && styles.ongletDesactive
                    ]}
                    disabled={!codeModifie}
                    onPress={() => setOngletActif('modifie')}
                  >
                    <Text style={[
                      styles.texteOnglet, 
                      ongletActif === 'modifie' && styles.texteOngletActif,
                      !codeModifie && styles.texteOngletDesactive
                    ]}>
                      Code Modifié ✨
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Zone de code */}
                <View style={styles.zoneCode}>
                  <ScrollView style={styles.defilementCode} horizontal>
                    <ScrollView>
                      <Text style={styles.texteCodeMonospace}>
                        {ongletActif === 'original' ? codeOriginal : codeModifie}
                      </Text>
                    </ScrollView>
                  </ScrollView>
                </View>

                {/* Saisie de la Consigne */}
                <View style={styles.zoneConsole}>
                  <TextInput
                    style={styles.inputConsigne}
                    placeholder="Saisissez la consigne (Gemini prendra en compte tous vos fichiers sélectionnés...)"
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
                    <Text style={styles.texteBoutonGenerer}>🧠 Demander modification à Gemini</Text>
                  </TouchableOpacity>
                </View>

                {/* Soumission GitHub */}
                {codeModifie !== '' && (
                  <View style={styles.zoneSoumission}>
                    <TouchableOpacity style={styles.boutonCommiter} onPress={gererSoumissionGitHub}>
                      <Text style={styles.texteBoutonCommiter}>🚀 Commiter & Ouvrir Pull Request</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* PR Ouverte */}
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
