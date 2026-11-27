# Guide administrateur

L’application est réservée aux administrateurs. Les professeurs paient le centre pour leurs séances terminées. Les dates et horaires suivent Africa/Tunis ; les montants sont en dinars tunisiens, avec trois décimales. La durée d’une séance ne multiplie pas son prix.

Le menu contient **Tableau de bord**, **Emploi du temps**, **Salles**, **Professeurs**, **Paiements** et **Paramètres**. Les séances se gèrent dans l’emploi du temps. Le tableau de bord présente le mois courant à Tunis par défaut. Utilisez **Mois sélectionné** ou les boutons précédent/suivant pour consulter un autre mois ; **Mois actuel** revient à la période courante. Les cartes, séances et soldes affichés suivent ce choix, sans graphique et sans modification automatique des statuts.

Les encaissements du mois suivent la date des paiements. Le reste à encaisser concerne les séances de ce mois et tient compte de leurs règlements reçus à ce jour. Lors d’un paiement, l’application règle toujours les plus anciennes séances du professeur, tous mois confondus ; l’aperçu précise cette répartition avant confirmation.

## 1. Créer une salle

Dans **Salles**, cliquez sur **Ajouter une salle**. Saisissez le nom, éventuellement une description, puis cliquez sur **Enregistrer**. La salle est active par défaut.

Les boutons de consultation et de modification permettent ensuite de voir sa disponibilité ou de corriger sa fiche. Une salle ayant des réservations futures ne peut pas être désactivée : il faut d’abord les déplacer ou les annuler dans l’agenda.

## 2. Créer un professeur

Dans **Professeurs**, cliquez sur **Ajouter un professeur**. Renseignez **Prénom**, **Nom** et **Téléphone**. L’e-mail, l’adresse et les notes sont facultatifs. Cliquez sur **Enregistrer** ; la fiche s’ouvre sur la tarification.

La désactivation interdit de nouvelles réservations pour ce professeur et conserve sa fiche, ses séances et ses paiements. Un professeur inactif peut toujours régler sa dette.

## 3. Configurer le prix habituel par séance

Ouvrez la fiche du professeur, puis **Tarification** → **Ajouter un tarif**. Saisissez **Prix par séance**, **Début de validité** et, si nécessaire, **Fin (facultative)**. Cliquez sur **Enregistrer le tarif**.

Pour un nouveau prix succédant à un tarif existant, utilisez **Clôturer le tarif précédent à la veille du nouveau tarif** si les périodes se chevaucheraient. Les séances terminées gardent leur prix historique ; un changement de convention ne les recalcule pas.

## 4. Réserver une séance fixe

Dans **Emploi du temps**, choisissez le jour, puis cliquez sur un créneau libre ou sur **Ajouter une séance**. Sélectionnez **Fixe · chaque semaine**, le professeur, la salle, le jour de semaine et le **Début de la programmation**. La fin de programmation est facultative.

Choisissez les heures par pas de trente minutes, vérifiez **Tarif appliqué**, puis cliquez sur **Ajouter**. La séance se répète au jour choisi dans la période indiquée. Les jours fermés, les horaires extérieurs aux heures du centre et les conflits de salle ou de professeur sont refusés. Un tarif exceptionnel saisi à cette création concerne seulement la première séance.

## 5. Réserver une séance provisoire

Dans l’agenda, cliquez sur le créneau souhaité ou sur **Ajouter une séance**, puis gardez **Provisoire · une seule date**. Choisissez professeur, salle, date, début et fin. Vérifiez le tarif et cliquez sur **Ajouter**.

Cette réservation ne se répète pas. Les mêmes contrôles d’ouverture et de disponibilité s’appliquent aux séances fixes et provisoires. Des séances adjacentes sont autorisées : l’une peut finir à 10:00 et l’autre commencer à 10:00.

## 6. Modifier le prix d’une seule séance

Ouvrez une séance prévue ou en cours, puis **Modifier cette séance uniquement**. Activez **Appliquer un tarif exceptionnel à cette séance**, saisissez **Tarif exceptionnel (DT)**, vérifiez le montant, puis cliquez sur **Enregistrer la séance**. **Rétablir le tarif habituel** retire cette exception.

Pour une fixe, les autres semaines et le prix habituel du professeur restent inchangés. Un déplacement individuel reste limité à la semaine d’origine. Si vous changez le professeur d’une séance portant une exception, choisissez explicitement de conserver ce prix ou de rétablir le tarif du nouveau professeur.

Une séance déjà terminée utilise **Corriger le tarif de cette séance terminée**, avec motif et aperçu de correction. Une correction qui rendrait les paiements reçus supérieurs aux charges est refusée ; elle ne modifie pas silencieusement les encaissements.

## 7. Annuler une seule occurrence

Ouvrez la séance, cliquez sur **Annuler la séance**, puis gardez **Annuler uniquement cette séance** pour une fixe. Vérifiez professeur, salle, date et heures. Ajoutez éventuellement un motif, puis cliquez sur **Confirmer l’annulation**. Une provisoire présente directement sa confirmation individuelle.

Le créneau de salle et de professeur est immédiatement libéré, sans charge financière. Les autres semaines d’une fixe restent réservées. **Ajouter une séance à ce créneau** ouvre une nouvelle réservation préremplie avec les horaires et la salle ; sélectionnez son professeur. Une provisoire est proposée après une annulation isolée. Une nouvelle fixe est refusée si elle chevauche les semaines encore réservées par l’ancienne programmation.

Les séances annulées sont masquées par défaut ; activez **Afficher les séances annulées** pour consulter leur historique. Une séance terminée ne peut pas être annulée par cette action.

## 8. Arrêter une programmation fixe

Ouvrez la séance à partir de laquelle l’arrêt doit prendre effet. Cliquez sur **Annuler la séance**, choisissez **Annuler cette séance et toutes les suivantes**, puis cochez **Je confirme l’arrêt définitif de cette programmation à partir de cette séance**. Vérifiez la date et cliquez sur **Confirmer l’annulation**.

L’arrêt concerne cette série seulement. La séance choisie et les réservations futures prévues ou en cours de cette série, y compris les occurrences déplacées, sont annulées. Les anciennes séances, les absences déjà enregistrées et les montants historiques sont conservés. La présence d’une séance déjà terminée à partir de la date choisie bloque entièrement l’arrêt.

L’arrêt est définitif. Pour reprendre ce créneau régulièrement, créez une nouvelle fixe indépendante avec **Ajouter une séance à ce créneau**. L’action **Arrêter la programmation fixe** reste également disponible dans les détails : elle agit à partir du lundi choisi dans **À partir de la semaine du**, après confirmation explicite.

## 9. Marquer une séance comme terminée

Ouvrez la séance et cliquez sur **Marquer comme terminée**. Dans **Confirmer la fin de séance et son tarif**, vérifiez le professeur, la date, les horaires et le montant final dû. Vous pouvez encore choisir un tarif exceptionnel individuel. Cliquez sur **Confirmer la fin de séance**.

Cette confirmation fige le prix historique et crée la charge de la séance. Elle n’enregistre aucun paiement. En l’absence de tarif habituel valable pour cette date, renseignez une exception ou définissez d’abord la convention du professeur. Les actions **Marquer en cours** et **Marquer absent** sont distinctes ; une absence ne crée pas de charge.

## 10. Enregistrer un paiement

Dans **Paiements**, cliquez sur **Enregistrer un paiement**, ou utilisez cette action depuis la fiche du professeur ou le tableau de bord. Choisissez **Professeur**, vérifiez sa situation avant paiement, puis renseignez **Montant reçu (DT)** et **Date du paiement**. La date proposée est aujourd’hui à Tunis ; une date future est refusée. **Note (facultative)** permet de conserver une précision.

Le montant doit être positif et ne peut pas dépasser le **Reste à encaisser**. Sans dette, la saisie est bloquée. Attendez l’aperçu automatique, vérifiez les séances qui seront réglées ou partiellement réglées et le solde restant, puis cliquez sur **Confirmer le paiement**.

Tous les nouveaux paiements sont enregistrés en espèces. L’affectation règle automatiquement les séances terminées les plus anciennes ; vous ne choisissez pas les séances à payer. Par exemple, une charge de 20,000 DT réglée à hauteur de 15,000 DT reste partiellement payée avec 5,000 DT à régler. Aucun versement pour des séances futures n’est accepté.

En cas d’erreur de saisie, consultez les détails du paiement et utilisez sa correction ou son annulation avec un motif. L’écriture d’origine et l’historique des affectations sont conservés.

## 11. Consulter les séances restant à régler

Dans **Paiements** → **Soldes des professeurs**, recherchez le nom ou le téléphone et sélectionnez **Solde impayé** ou **Paiement partiel**. Consultez **Reste à encaisser**, développez la ligne ou ouvrez **Détails financiers**.

Dans la fiche du professeur, l’onglet **Paiements** permet de filtrer les séances **Non payées** ou **Partiellement payées** et de consulter leur prix historique, montant payé et reste à payer. **Paiements associés** affiche les écritures liées. **Historique des paiements** conserve les encaissements et leurs corrections. Le statut financier est calculé automatiquement ; il ne se modifie pas manuellement.

## 12. Changer le mot de passe administrateur

Dans **Paramètres** → **Sécurité du compte**, saisissez **Mot de passe actuel**, **Nouveau mot de passe** et **Confirmer le nouveau mot de passe**. Le nouveau mot de passe doit comporter de 12 à 256 caractères et être différent du précédent. Cliquez sur **Modifier le mot de passe**.

Après réussite, toutes les sessions existantes sont invalidées. Reconnectez-vous avec le nouveau mot de passe. Si le mot de passe actuel est incorrect ou si les deux saisies diffèrent, la modification est refusée.

## Informations, logo et horaires du centre

Dans **Paramètres** → **Informations du centre**, renseignez le nom, le téléphone, l’adresse et éventuellement l’adresse e-mail. Le nom et le logo sont utilisés dans l’application et sur la page de connexion.

Dans **Logo du centre**, cliquez sur **Importer un logo** ou **Remplacer le logo**. Choisissez une image PNG, JPEG ou WebP de 2 Mo maximum, vérifiez son aperçu, puis cliquez sur **Enregistrer le logo**. **Annuler l’import** abandonne cet aperçu ; **Supprimer le logo** revient au visuel par défaut. Le logo enregistré est conservé dans la base de données, y compris après redémarrage de l’application ou de ses conteneurs.

Dans **Horaires du centre**, choisissez **Heure d’ouverture**, **Heure de fermeture** et **Jours d’ouverture**, puis cliquez sur **Enregistrer les paramètres**. La fermeture doit suivre l’ouverture ; les heures suivent des pas de trente minutes. Les nouvelles réservations respectent ces réglages. Avant configuration, la plage conservatrice est 00:00–24:00, tous les jours.

Si une réservation future concrète ou une occurrence fixe reste incompatible, le changement est refusé avec une date de conflit. Déplacez ou annulez les réservations concernées, puis recommencez. Les séances ne sont jamais corrigées automatiquement. Les anciennes séances restent accessibles ; l’agenda peut étendre sa plage pour les afficher, et le choix **Journée entière** permet une consultation de 00:00 à 24:00.

**Préférences de l’application** affiche les valeurs fixes : français, dinar tunisien et Africa/Tunis. Les sauvegardes et le déploiement serveur relèvent des procédures techniques à préparer en phase 6 ; aucun outil d’export financier n’est ajouté à ce panneau.
