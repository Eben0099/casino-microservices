"""Module replay : plans de tickets recurrents (re-jeu automatique sur N rounds).

Un caissier peut vendre un ticket en demandant de le rejouer sur les
N rounds suivants (max 10). On debite N x total_wager d'un coup, puis a
chaque nouveau round Betting le ticket-service genere automatiquement un
ticket fils avec la meme composition. Le plan peut etre annule a tout
moment : les rounds restants sont rembourses en caisse.
"""
