-- Tracks are now Web App, Mobile App and Other (src/data/hackday.ts). Teams made before that
-- (AI Agent and Voice, Data and Dashboards, Wildcard, the old default) become Other. The site
-- already shows them as Other (trackLabel); this makes the stored value agree.
update teams set track = 'Other' where track not in ('Web App', 'Mobile App', 'Other');
