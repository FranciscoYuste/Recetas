-- GENERADO por enriquecimiento_ia/reclasificar_recetas.py — no editar a mano,
-- cambiar las reglas allí y volver a generarlo.
--
-- Mejora los datos de las recetas importadas. Ejecutar en Supabase → SQL Editor.
-- Es seguro repetirlo. No borra ninguna receta: las malas se marcan como "ocultas"
-- (se pueden volver a mostrar desde la app, filtro «🙈 Ocultas»).
-- Las recetas propias (propia = true) no se tocan.
--
-- Qué hace:
--   1. Columnas nuevas: recetas.tipo, recetas.oculta, recetas.notas.
--   2. Recupera 279 títulos rotos («¡Ideal para compartir!») desde la URL.
--   3. Clasifica cada receta por tipo (principal, dulce, bebida, salsa, aperitivo, pan,
--      ocasion). Solo los principales se proponen para el menú semanal.
--   4. Recalcula la categoría mirando el título y crea categorías nuevas
--      (Legumbres, Arroces, Verduras, Huevos, Pizzas y bocadillos, Aperitivos, Panes, Salsas y bases, Bebidas).
--   5. Oculta duplicados (mismo título; se queda la favorita/en uso o la más completa)
--      y recetas sin pasos útiles.

begin;

-- 1. Columnas ----------------------------------------------------------------
alter table recetas add column if not exists propia boolean not null default false;
alter table recetas add column if not exists tipo text;
alter table recetas add column if not exists oculta boolean not null default false;
alter table recetas add column if not exists notas text;
create index if not exists recetas_tipo_oculta_idx on recetas (tipo, oculta);

-- 2. Títulos rotos -----------------------------------------------------------
update recetas r set title = v.titulo
from (values
    ('https://www.recetasgratis.net/receta-de-empanada-de-verduras-y-manzana-64701.html', 'Empanada de verduras y manzana'),
    ('https://www.recetasgratis.net/receta-de-queso-vegano-tipo-mozzarella-65044.html', 'Queso vegano tipo mozzarella'),
    ('https://www.recetasgratis.net/receta-de-flores-de-salchichas-70051.html', 'Flores de salchichas'),
    ('https://www.recetasgratis.net/receta-de-ternera-guisada-con-ciruelas-64517.html', 'Ternera guisada con ciruelas'),
    ('https://www.recetasgratis.net/receta-de-acordeon-de-tomate-64356.html', 'Acordeon de tomate'),
    ('https://www.recetasgratis.net/receta-de-tortilla-vegana-rellena-70116.html', 'Tortilla vegana rellena'),
    ('https://www.recetasgratis.net/receta-de-paella-vegana-de-quinoa-65673.html', 'Paella vegana de quinoa'),
    ('https://www.recetasgratis.net/receta-de-langostinos-fritos-7883.html', 'Langostinos fritos'),
    ('https://www.recetasgratis.net/receta-de-crepes-dulces-para-4-personas-59758.html', 'Crepes dulces para 4 personas'),
    ('https://www.recetasgratis.net/receta-de-crema-de-caramelo-con-nata-65852.html', 'Crema de caramelo con nata'),
    ('https://www.recetasgratis.net/receta-de-huevos-rellenos-al-horno-60959.html', 'Huevos rellenos al horno'),
    ('https://www.recetasgratis.net/receta-de-nuomici-de-platano-66771.html', 'Nuomici de plátano'),
    ('https://www.recetasgratis.net/receta-de-pasta-con-coliflor-y-queso-66358.html', 'Pasta con coliflor y queso'),
    ('https://www.recetasgratis.net/receta-de-salsa-tartara-light-69509.html', 'Salsa tartara light'),
    ('https://www.recetasgratis.net/receta-de-falafel-de-alubias-rojas-66447.html', 'Falafel de alubias rojas'),
    ('https://www.recetasgratis.net/receta-de-alambre-de-bistec-de-puerco-62457.html', 'Alambre de bistec de puerco'),
    ('https://www.recetasgratis.net/receta-de-tarta-de-queso-fria-71027.html', 'Tarta de queso fria'),
    ('https://www.recetasgratis.net/receta-de-fideua-vegetariana-62498.html', 'Fideua vegetariana'),
    ('https://www.recetasgratis.net/receta-de-tortitas-de-camarones-sin-gluten-69578.html', 'Tortitas de camarones sin gluten'),
    ('https://www.recetasgratis.net/receta-de-tarta-de-pina-fria-17701.html', 'Tarta de piña fria'),
    ('https://www.recetasgratis.net/receta-de-papas-duquesas-al-horno-64456.html', 'Papas duquesas al horno'),
    ('https://www.recetasgratis.net/receta-de-setas-con-vieiras-64767.html', 'Setas con vieiras'),
    ('https://www.recetasgratis.net/receta-de-fajitas-de-verduras-y-tofu-70560.html', 'Fajitas de verduras y tofu'),
    ('https://www.recetasgratis.net/receta-de-quiche-de-espinacas-y-pavo-62578.html', 'Quiche de espinacas y pavo'),
    ('https://www.recetasgratis.net/receta-de-gambones-a-la-plancha-72136.html', 'Gambones a la plancha'),
    ('https://www.recetasgratis.net/receta-de-crepas-dulces-caseras-10637.html', 'Crepas dulces caseras'),
    ('https://www.recetasgratis.net/receta-de-quesillo-de-mango-69720.html', 'Quesillo de mango'),
    ('https://www.recetasgratis.net/receta-de-sopa-oriental-vegana-64185.html', 'Sopa oriental vegana'),
    ('https://www.recetasgratis.net/receta-de-canelones-de-carne-vegetal-65528.html', 'Canelones de carne vegetal'),
    ('https://www.recetasgratis.net/receta-de-crepes-salados-de-pollo-11252.html', 'Crepes salados de pollo'),
    ('https://www.recetasgratis.net/receta-de-canelones-de-carne-y-pate-47775.html', 'Canelones de carne y paté'),
    ('https://www.recetasgratis.net/receta-de-patatas-a-la-riojana-con-carne-63994.html', 'Patatas a la riojana con carne'),
    ('https://www.recetasgratis.net/receta-de-nutella-vegana-con-calabaza-69316.html', 'Nutella vegana con calabaza'),
    ('https://www.recetasgratis.net/receta-de-tarta-pancho-69966.html', 'Tarta pancho'),
    ('https://www.recetasgratis.net/receta-de-arroz-al-queso-8685.html', 'Arroz al queso'),
    ('https://www.recetasgratis.net/receta-de-mermelada-de-patata-70327.html', 'Mermelada de patata'),
    ('https://www.recetasgratis.net/receta-de-burritos-de-pescado-con-merluza-51705.html', 'Burritos de pescado con merluza'),
    ('https://www.recetasgratis.net/receta-de-guirlache-de-almendras-51245.html', 'Guirlache de almendras'),
    ('https://www.recetasgratis.net/receta-de-merluza-frita-en-adobo-64503.html', 'Merluza frita en adobo'),
    ('https://www.recetasgratis.net/receta-de-cocada-venezolana-67785.html', 'Cocada venezolana'),
    ('https://www.recetasgratis.net/receta-de-papas-asadas-de-feria-68744.html', 'Papas asadas de feria'),
    ('https://www.recetasgratis.net/receta-de-chips-de-kale-68275.html', 'Chips de kale'),
    ('https://www.recetasgratis.net/receta-de-coliflor-con-salsa-buffalo-64700.html', 'Coliflor con salsa buffalo'),
    ('https://www.recetasgratis.net/receta-de-sopa-de-cebolla-casera-59645.html', 'Sopa de cebolla casera'),
    ('https://www.recetasgratis.net/receta-de-dip-de-atun-22949.html', 'Dip de atún'),
    ('https://www.recetasgratis.net/receta-de-fusilli-con-crema-de-champinones-65133.html', 'Fusilli con crema de champiñones'),
    ('https://www.recetasgratis.net/receta-de-tostas-de-bacon-y-queso-63891.html', 'Tostas de bacon y queso'),
    ('https://www.recetasgratis.net/receta-de-paella-de-higado-de-toro-66448.html', 'Paella de higado de toro'),
    ('https://www.recetasgratis.net/receta-de-mondongo-criollo-venezolano-34456.html', 'Mondongo criollo venezolano'),
    ('https://www.recetasgratis.net/receta-de-patatas-deluxe-al-horno-70328.html', 'Patatas deluxe al horno'),
    ('https://www.recetasgratis.net/receta-de-canapes-de-platano-macho-62549.html', 'Canapes de plátano macho'),
    ('https://www.recetasgratis.net/receta-de-lacon-cocido-20937.html', 'Lacon cocido'),
    ('https://www.recetasgratis.net/receta-de-empanadillas-de-bacalao-65271.html', 'Empanadillas de bacalao'),
    ('https://www.recetasgratis.net/receta-de-petit-bouche-48468.html', 'Petit bouche'),
    ('https://www.recetasgratis.net/receta-de-flan-de-turron-sin-huevo-65879.html', 'Flan de turrón sin huevo'),
    ('https://www.recetasgratis.net/receta-de-lentejas-con-patatas-59784.html', 'Lentejas con patatas'),
    ('https://www.recetasgratis.net/receta-de-trufas-de-chocolate-blanco-71656.html', 'Trufas de chocolate blanco'),
    ('https://www.recetasgratis.net/receta-de-focaccia-de-verduras-62822.html', 'Focaccia de verduras'),
    ('https://www.recetasgratis.net/receta-de-croquetas-de-espinacas-30030.html', 'Croquetas de espinacas'),
    ('https://www.recetasgratis.net/receta-de-ensaladilla-rusa-con-variantes-66359.html', 'Ensaladilla rusa con variantes'),
    ('https://www.recetasgratis.net/receta-de-carpaccio-de-frutas-65059.html', 'Carpaccio de frutas'),
    ('https://www.recetasgratis.net/receta-de-empanadas-al-horno-34558.html', 'Empanadas al horno'),
    ('https://www.recetasgratis.net/receta-de-lentejas-al-curry-veganas-70000.html', 'Lentejas al curry veganas'),
    ('https://www.recetasgratis.net/receta-de-empanadillas-de-manzana-71218.html', 'Empanadillas de manzana'),
    ('https://www.recetasgratis.net/receta-de-raviolis-con-salsa-de-nueces-64171.html', 'Raviolis con salsa de nueces'),
    ('https://www.recetasgratis.net/receta-de-cafe-dalgona-74263.html', 'Café dalgona'),
    ('https://www.recetasgratis.net/receta-de-hummus-en-thermomix-65338.html', 'Hummus en thermomix'),
    ('https://www.recetasgratis.net/receta-de-crema-de-cappuccino-67426.html', 'Crema de cappuccino'),
    ('https://www.recetasgratis.net/receta-de-figuritas-de-mazapan-71630.html', 'Figuritas de mazapán'),
    ('https://www.recetasgratis.net/receta-de-coquitos-caseros-8678.html', 'Coquitos caseros'),
    ('https://www.recetasgratis.net/receta-de-bolitas-de-arroz-al-horno-69841.html', 'Bolitas de arroz al horno'),
    ('https://www.recetasgratis.net/receta-de-atun-a-la-veracruzana-62474.html', 'Atún a la veracruzana'),
    ('https://www.recetasgratis.net/receta-de-totopos-con-harina-de-maiz-63376.html', 'Totopos con harina de maíz'),
    ('https://www.recetasgratis.net/receta-de-pescado-con-mojo-de-cilantro-66915.html', 'Pescado con mojo de cilantro'),
    ('https://www.recetasgratis.net/receta-de-rape-en-salsa-verde-71638.html', 'Rape en salsa verde'),
    ('https://www.recetasgratis.net/receta-de-torta-de-maiz-facil-y-cremosa-71991.html', 'Torta de maíz fácil y cremosa'),
    ('https://www.recetasgratis.net/receta-de-pierna-de-cerdo-adobada-para-navidad-64466.html', 'Pierna de cerdo adobada para navidad'),
    ('https://www.recetasgratis.net/receta-de-huevos-revueltos-veganos-62952.html', 'Huevos revueltos veganos'),
    ('https://www.recetasgratis.net/receta-de-salsa-cardenal-25808.html', 'Salsa cardenal'),
    ('https://www.recetasgratis.net/receta-de-crepes-de-pollo-gratinados-71756.html', 'Crepes de pollo gratinados'),
    ('https://www.recetasgratis.net/receta-de-arroz-relleno-de-atun-64717.html', 'Arroz relleno de atún'),
    ('https://www.recetasgratis.net/receta-de-tofu-en-salsa-teriyaki-69106.html', 'Tofu en salsa teriyaki'),
    ('https://www.recetasgratis.net/receta-de-acelgas-guisadas-24912.html', 'Acelgas guisadas'),
    ('https://www.recetasgratis.net/receta-de-canelones-de-ricota-27173.html', 'Canelones de ricota'),
    ('https://www.recetasgratis.net/receta-de-cazon-en-salsa-verde-67762.html', 'Cazon en salsa verde'),
    ('https://www.recetasgratis.net/receta-de-empanadas-de-carne-32955.html', 'Empanadas de carne'),
    ('https://www.recetasgratis.net/receta-de-arrollado-de-pionono-salado-63203.html', 'Arrollado de pionono salado'),
    ('https://www.recetasgratis.net/receta-de-sandwich-de-tempeh-62954.html', 'Sandwich de tempeh'),
    ('https://www.recetasgratis.net/receta-de-torta-de-acelgas-25625.html', 'Torta de acelgas'),
    ('https://www.recetasgratis.net/receta-de-muchines-de-yuca-14830.html', 'Muchines de yuca'),
    ('https://www.recetasgratis.net/receta-de-muffins-de-granola-57581.html', 'Muffins de granola'),
    ('https://www.recetasgratis.net/receta-de-quesillo-de-jojoto-facil-64453.html', 'Quesillo de jojoto fácil'),
    ('https://www.recetasgratis.net/receta-de-budin-de-queso-45541.html', 'Budin de queso'),
    ('https://www.recetasgratis.net/receta-de-pastelitos-de-carne-57083.html', 'Pastelitos de carne'),
    ('https://www.recetasgratis.net/receta-de-shiro-etiope-70025.html', 'Shiro etiope'),
    ('https://www.recetasgratis.net/receta-de-frijoles-licuados-47296.html', 'Frijoles licuados'),
    ('https://www.recetasgratis.net/receta-de-faina-vegana-69161.html', 'Faina vegana'),
    ('https://www.recetasgratis.net/receta-de-coctel-lumumba-19784.html', 'Coctel lumumba'),
    ('https://www.recetasgratis.net/receta-de-pate-de-atun-vegano-66049.html', 'Paté de atún vegano'),
    ('https://www.recetasgratis.net/receta-de-salchichas-de-tofu-caseras-66413.html', 'Salchichas de tofu caseras'),
    ('https://www.recetasgratis.net/receta-de-tarta-de-salmon-71629.html', 'Tarta de salmón'),
    ('https://www.recetasgratis.net/receta-de-sopa-de-repollo-quema-grasa-57927.html', 'Sopa de repollo quema grasa'),
    ('https://www.recetasgratis.net/receta-de-flan-de-claras-38407.html', 'Flan de claras'),
    ('https://www.recetasgratis.net/receta-de-helado-de-huevo-50041.html', 'Helado de huevo'),
    ('https://www.recetasgratis.net/receta-de-sultanas-de-coco-17629.html', 'Sultanas de coco'),
    ('https://www.recetasgratis.net/receta-de-torta-imperial-6837.html', 'Torta imperial'),
    ('https://www.recetasgratis.net/receta-de-trufas-de-chocolate-y-mani-52139.html', 'Trufas de chocolate y maní'),
    ('https://www.recetasgratis.net/receta-de-rollo-de-carne-con-hojaldre-71631.html', 'Rollo de carne con hojaldre'),
    ('https://www.recetasgratis.net/receta-de-turron-de-lacasitos-71619.html', 'Turrón de lacasitos'),
    ('https://www.recetasgratis.net/receta-de-fajitas-de-pollo-a-la-bbq-66048.html', 'Fajitas de pollo a la bbq'),
    ('https://www.recetasgratis.net/receta-de-ternera-con-especias-63984.html', 'Ternera con especias'),
    ('https://www.recetasgratis.net/receta-de-albondigas-de-coliflor-68964.html', 'Albóndigas de coliflor'),
    ('https://www.recetasgratis.net/receta-de-salmon-ahumado-vegano-69317.html', 'Salmón ahumado vegano'),
    ('https://www.recetasgratis.net/receta-de-papas-gratinadas-26460.html', 'Papas gratinadas'),
    ('https://www.recetasgratis.net/receta-de-brocoli-al-vapor-con-ajo-65613.html', 'Brócoli al vapor con ajo'),
    ('https://www.recetasgratis.net/receta-de-cheesecake-de-ricota-71145.html', 'Cheesecake de ricota'),
    ('https://www.recetasgratis.net/receta-de-guacamole-con-granada-65494.html', 'Guacamole con granada'),
    ('https://www.recetasgratis.net/receta-de-chayotes-guisados-14510.html', 'Chayotes guisados'),
    ('https://www.recetasgratis.net/receta-de-acelgas-fritas-9090.html', 'Acelgas fritas'),
    ('https://www.recetasgratis.net/receta-de-tosta-de-gulas-y-gambas-71578.html', 'Tosta de gulas y gambas'),
    ('https://www.recetasgratis.net/receta-de-cazon-estilo-margariteno-67777.html', 'Cazon estilo margariteno'),
    ('https://www.recetasgratis.net/receta-de-profiteroles-de-fresa-65964.html', 'Profiteroles de fresa'),
    ('https://www.recetasgratis.net/receta-de-rollo-de-carne-vegano-70628.html', 'Rollo de carne vegano'),
    ('https://www.recetasgratis.net/receta-de-ensalada-caprese-vegana-65091.html', 'Ensalada caprese vegana'),
    ('https://www.recetasgratis.net/receta-de-batatas-caramelizadas-56943.html', 'Batatas caramelizadas'),
    ('https://www.recetasgratis.net/receta-de-lomo-al-champignon-7554.html', 'Lomo al champignon'),
    ('https://www.recetasgratis.net/receta-de-sushi-vegano-casero-69154.html', 'Sushi vegano casero'),
    ('https://www.recetasgratis.net/receta-de-tortitas-de-yuca-dulces-24867.html', 'Tortitas de yuca dulces'),
    ('https://www.recetasgratis.net/receta-de-palomitas-en-sarten-62168.html', 'Palomitas en sarten'),
    ('https://www.recetasgratis.net/receta-de-sopa-de-choclo-12078.html', 'Sopa de choclo'),
    ('https://www.recetasgratis.net/receta-de-guisantes-con-seitan-70725.html', 'Guisantes con seitan'),
    ('https://www.recetasgratis.net/receta-de-polos-de-fresa-y-yogur-69934.html', 'Polos de fresa y yogur'),
    ('https://www.recetasgratis.net/receta-de-sopa-de-crema-de-arveja-8137.html', 'Sopa de crema de arveja'),
    ('https://www.recetasgratis.net/receta-de-empanada-de-lomo-65289.html', 'Empanada de lomo'),
    ('https://www.recetasgratis.net/receta-de-truchas-de-batata-canaria-65708.html', 'Truchas de batata canaria'),
    ('https://www.recetasgratis.net/receta-de-lentejas-francesas-33487.html', 'Lentejas francesas'),
    ('https://www.recetasgratis.net/receta-de-acelgas-a-la-crema-37535.html', 'Acelgas a la crema'),
    ('https://www.recetasgratis.net/receta-de-ensalada-navidena-de-coditos-64782.html', 'Ensalada navidena de coditos'),
    ('https://www.recetasgratis.net/receta-de-hummus-de-tomate-seco-63845.html', 'Hummus de tomate seco'),
    ('https://www.recetasgratis.net/receta-de-arroz-con-pulpo-y-gambas-57797.html', 'Arroz con pulpo y gambas'),
    ('https://www.recetasgratis.net/receta-de-alcachofas-con-ajo-y-perejil-14226.html', 'Alcachofas con ajo y perejil'),
    ('https://www.recetasgratis.net/receta-de-chutney-de-albaricoque-70249.html', 'Chutney de albaricoque'),
    ('https://www.recetasgratis.net/receta-de-mole-poblano-58609.html', 'Mole poblano'),
    ('https://www.recetasgratis.net/receta-de-tortos-de-maiz-63980.html', 'Tortos de maíz'),
    ('https://www.recetasgratis.net/receta-de-masa-de-yuca-para-pizza-66906.html', 'Masa de yuca para pizza'),
    ('https://www.recetasgratis.net/receta-de-lentejas-con-pescado-58173.html', 'Lentejas con pescado'),
    ('https://www.recetasgratis.net/receta-de-lechon-al-horno-11887.html', 'Lechon al horno'),
    ('https://www.recetasgratis.net/receta-de-tortitas-de-batata-70684.html', 'Tortitas de batata'),
    ('https://www.recetasgratis.net/receta-de-torta-de-maqueno-17829.html', 'Torta de maqueno'),
    ('https://www.recetasgratis.net/receta-de-tarta-de-boniato-y-chocolate-70625.html', 'Tarta de boniato y chocolate'),
    ('https://www.recetasgratis.net/receta-de-tarta-de-hojaldre-con-setas-63304.html', 'Tarta de hojaldre con setas'),
    ('https://www.recetasgratis.net/receta-de-souffle-de-queso-y-brocoli-66649.html', 'Souffle de queso y brócoli'),
    ('https://www.recetasgratis.net/receta-de-dulce-de-pomarrosa-38122.html', 'Dulce de pomarrosa'),
    ('https://www.recetasgratis.net/receta-de-gofres-belgas-veganos-64720.html', 'Gofres belgas veganos'),
    ('https://www.recetasgratis.net/receta-de-patatas-deluxe-especiadas-70523.html', 'Patatas deluxe especiadas'),
    ('https://www.recetasgratis.net/receta-de-pernil-a-lo-panameno-17095.html', 'Pernil a lo panameno'),
    ('https://www.recetasgratis.net/receta-de-pure-de-arvejas-65082.html', 'Puré de arvejas'),
    ('https://www.recetasgratis.net/receta-de-sopa-de-ajo-y-cebolla-58326.html', 'Sopa de ajo y cebolla'),
    ('https://www.recetasgratis.net/receta-de-arroz-montanes-con-setas-64297.html', 'Arroz montanes con setas'),
    ('https://www.recetasgratis.net/receta-de-estofado-de-seitan-con-patatas-64146.html', 'Estofado de seitan con patatas'),
    ('https://www.recetasgratis.net/receta-de-mousse-de-limon-con-nata-66017.html', 'Mousse de limón con nata'),
    ('https://www.recetasgratis.net/receta-de-pizzas-individuales-38992.html', 'Pizzas individuales'),
    ('https://www.recetasgratis.net/receta-de-aguacates-gratinados-68958.html', 'Aguacates gratinados'),
    ('https://www.recetasgratis.net/receta-de-morcilla-vegana-facil-71898.html', 'Morcilla vegana fácil'),
    ('https://www.recetasgratis.net/receta-de-natillas-de-maicena-y-leche-64551.html', 'Natillas de maicena y leche'),
    ('https://www.recetasgratis.net/receta-de-panqueques-sin-leche-63433.html', 'Panqueques sin leche'),
    ('https://www.recetasgratis.net/receta-de-merengues-de-colores-al-horno-63326.html', 'Merengues de colores al horno'),
    ('https://www.recetasgratis.net/receta-de-wrap-de-pavo-65320.html', 'Wrap de pavo'),
    ('https://www.recetasgratis.net/receta-de-hamburguesas-para-halloween-59640.html', 'Hamburguesas para halloween'),
    ('https://www.recetasgratis.net/receta-de-judias-blancas-con-verduras-26550.html', 'Judias blancas con verduras'),
    ('https://www.recetasgratis.net/receta-de-pastel-de-choclo-14195.html', 'Pastel de choclo'),
    ('https://www.recetasgratis.net/receta-de-mbourake-senegales-70362.html', 'Mbourake senegales'),
    ('https://www.recetasgratis.net/receta-de-cochino-frito-26333.html', 'Cochino frito'),
    ('https://www.recetasgratis.net/receta-de-empanadillas-de-pisto-70813.html', 'Empanadillas de pisto'),
    ('https://www.recetasgratis.net/receta-de-albondigas-de-bulgur-64602.html', 'Albóndigas de bulgur'),
    ('https://www.recetasgratis.net/receta-de-palomitas-al-curry-63766.html', 'Palomitas al curry'),
    ('https://www.recetasgratis.net/receta-de-flan-de-miel-con-nueces-65977.html', 'Flan de miel con nueces'),
    ('https://www.recetasgratis.net/receta-de-torta-de-arroz-71035.html', 'Torta de arroz'),
    ('https://www.recetasgratis.net/receta-de-pabellon-margariteno-69774.html', 'Pabellon margariteno'),
    ('https://www.recetasgratis.net/receta-de-mermelada-de-aji-dulce-62893.html', 'Mermelada de ají dulce'),
    ('https://www.recetasgratis.net/receta-de-babka-de-chocolate-67771.html', 'Babka de chocolate'),
    ('https://www.recetasgratis.net/receta-de-ensalada-de-lechuga-con-encurtidos-64357.html', 'Ensalada de lechuga con encurtidos'),
    ('https://www.recetasgratis.net/receta-de-alcachofas-rebozadas-con-jamon-24939.html', 'Alcachofas rebozadas con jamón'),
    ('https://www.recetasgratis.net/receta-de-tortilla-de-calabacin-al-horno-71746.html', 'Tortilla de calabacín al horno'),
    ('https://www.recetasgratis.net/receta-de-arroz-al-horno-con-costillas-65449.html', 'Arroz al horno con costillas'),
    ('https://www.recetasgratis.net/receta-de-setas-con-jamon-71220.html', 'Setas con jamón'),
    ('https://www.recetasgratis.net/receta-de-albondigas-italianas-65503.html', 'Albóndigas italianas'),
    ('https://www.recetasgratis.net/receta-de-hummus-de-pimiento-asado-66910.html', 'Hummus de pimiento asado'),
    ('https://www.recetasgratis.net/receta-de-huevos-a-la-espanola-7694.html', 'Huevos a la española'),
    ('https://www.recetasgratis.net/receta-de-mayonesa-de-albahaca-70368.html', 'Mayonesa de albahaca'),
    ('https://www.recetasgratis.net/receta-de-potaje-vegano-de-alubias-rojas-67414.html', 'Potaje vegano de alubias rojas'),
    ('https://www.recetasgratis.net/receta-de-romeritos-veganos-67925.html', 'Romeritos veganos'),
    ('https://www.recetasgratis.net/receta-de-ensalada-de-judiones-70698.html', 'Ensalada de judiones'),
    ('https://www.recetasgratis.net/receta-de-crema-de-atun-para-untar-58965.html', 'Crema de atún para untar'),
    ('https://www.recetasgratis.net/receta-de-mazapan-vegano-sin-azucar-64105.html', 'Mazapán vegano sin azúcar'),
    ('https://www.recetasgratis.net/receta-de-waffles-veganos-66222.html', 'Waffles veganos'),
    ('https://www.recetasgratis.net/receta-de-garbanzos-tostados-con-especias-63800.html', 'Garbanzos tostados con especias'),
    ('https://www.recetasgratis.net/receta-de-picadillo-de-carne-molida-6468.html', 'Picadillo de carne molida'),
    ('https://www.recetasgratis.net/receta-de-pudin-de-pan-navideno-65525.html', 'Pudin de pan navideno'),
    ('https://www.recetasgratis.net/receta-de-caldo-depurativo-con-apio-65610.html', 'Caldo depurativo con apio'),
    ('https://www.recetasgratis.net/receta-de-lapas-a-la-plancha-6400.html', 'Lapas a la plancha'),
    ('https://www.recetasgratis.net/receta-de-cucuruchos-de-espinacas-64212.html', 'Cucuruchos de espinacas'),
    ('https://www.recetasgratis.net/receta-de-sopa-de-avena-para-cenar-64452.html', 'Sopa de avena para cenar'),
    ('https://www.recetasgratis.net/receta-de-higado-asado-14025.html', 'Higado asado'),
    ('https://www.recetasgratis.net/receta-de-noquis-veganos-57643.html', 'Noquis veganos'),
    ('https://www.recetasgratis.net/receta-de-lentejas-a-la-vinagreta-28739.html', 'Lentejas a la vinagreta'),
    ('https://www.recetasgratis.net/receta-de-veganesa-de-aguacate-64455.html', 'Veganesa de aguacate'),
    ('https://www.recetasgratis.net/receta-de-atolillo-24254.html', 'Atolillo'),
    ('https://www.recetasgratis.net/receta-de-torta-de-platano-venezolana-67782.html', 'Torta de plátano venezolana'),
    ('https://www.recetasgratis.net/receta-de-panellets-de-calabaza-71248.html', 'Panellets de calabaza'),
    ('https://www.recetasgratis.net/receta-de-berenjena-rebozada-al-horno-71509.html', 'Berenjena rebozada al horno'),
    ('https://www.recetasgratis.net/receta-de-setas-rebozadas-70862.html', 'Setas rebozadas'),
    ('https://www.recetasgratis.net/receta-de-ensalada-de-papa-y-pasta-36903.html', 'Ensalada de papa y pasta'),
    ('https://www.recetasgratis.net/receta-de-chirmol-guatemalteco-14020.html', 'Chirmol guatemalteco'),
    ('https://www.recetasgratis.net/receta-de-lentejas-con-quinoa-y-curry-63350.html', 'Lentejas con quinoa y curry'),
    ('https://www.recetasgratis.net/receta-de-rollo-de-pollo-vegano-70539.html', 'Rollo de pollo vegano'),
    ('https://www.recetasgratis.net/receta-de-mafe-vegano-70450.html', 'Mafe vegano'),
    ('https://www.recetasgratis.net/receta-de-quesada-de-manzana-67304.html', 'Quesada de manzana'),
    ('https://www.recetasgratis.net/receta-de-pinolillo-10598.html', 'Pinolillo'),
    ('https://www.recetasgratis.net/receta-de-panquecas-sin-gluten-69504.html', 'Panquecas sin gluten'),
    ('https://www.recetasgratis.net/receta-de-macarrones-con-hummus-70706.html', 'Macarrones con hummus'),
    ('https://www.recetasgratis.net/receta-de-chips-de-calabaza-58071.html', 'Chips de calabaza'),
    ('https://www.recetasgratis.net/receta-de-risotto-de-queso-brie-70043.html', 'Risotto de queso brie'),
    ('https://www.recetasgratis.net/receta-de-carne-con-miso-64336.html', 'Carne con miso'),
    ('https://www.recetasgratis.net/receta-de-batatas-en-almibar-caseras-67773.html', 'Batatas en almíbar caseras'),
    ('https://www.recetasgratis.net/receta-de-burritos-de-choriqueso-60766.html', 'Burritos de choriqueso'),
    ('https://www.recetasgratis.net/receta-de-fosforera-venezolana-69744.html', 'Fosforera venezolana'),
    ('https://www.recetasgratis.net/receta-de-brownie-crudivegano-70065.html', 'Brownie crudivegano'),
    ('https://www.recetasgratis.net/receta-de-arroz-de-coliflor-vegano-70718.html', 'Arroz de coliflor vegano'),
    ('https://www.recetasgratis.net/receta-de-tartaleta-de-pina-55470.html', 'Tartaleta de piña'),
    ('https://www.recetasgratis.net/receta-de-pastel-de-chocolate-con-datiles-70156.html', 'Pastel de chocolate con datiles'),
    ('https://www.recetasgratis.net/receta-de-pescaditos-fritos-6798.html', 'Pescaditos fritos'),
    ('https://www.recetasgratis.net/receta-de-salsa-de-mostaza-y-limon-39314.html', 'Salsa de mostaza y limón'),
    ('https://www.recetasgratis.net/receta-de-cambures-dulces-26309.html', 'Cambures dulces'),
    ('https://www.recetasgratis.net/receta-de-strudel-de-chocolate-70722.html', 'Strudel de chocolate'),
    ('https://www.recetasgratis.net/receta-de-brownie-de-chocolate-51326.html', 'Brownie de chocolate'),
    ('https://www.recetasgratis.net/receta-de-paninis-sin-horno-68532.html', 'Paninis sin horno'),
    ('https://www.recetasgratis.net/receta-de-ensalada-de-tomate-y-pimiento-asado-64088.html', 'Ensalada de tomate y pimiento asado'),
    ('https://www.recetasgratis.net/receta-de-kebab-vegano-con-seitan-64500.html', 'Kebab vegano con seitan'),
    ('https://www.recetasgratis.net/receta-de-tarta-sacher-nestle-24149.html', 'Tarta sacher nestle'),
    ('https://www.recetasgratis.net/receta-de-ensalada-de-caballa-en-aceite-65532.html', 'Ensalada de caballa en aceite'),
    ('https://www.recetasgratis.net/receta-de-fajitas-veganas-70092.html', 'Fajitas veganas'),
    ('https://www.recetasgratis.net/receta-de-pesto-de-espinacas-vegano-63015.html', 'Pesto de espinacas vegano'),
    ('https://www.recetasgratis.net/receta-de-mariscal-caliente-46513.html', 'Mariscal caliente'),
    ('https://www.recetasgratis.net/receta-de-tomates-al-microondas-26893.html', 'Tomates al microondas'),
    ('https://www.recetasgratis.net/receta-de-salmon-al-horno-con-coliflor-64799.html', 'Salmón al horno con coliflor'),
    ('https://www.recetasgratis.net/receta-de-coliflor-con-queso-al-horno-64847.html', 'Coliflor con queso al horno'),
    ('https://www.recetasgratis.net/receta-de-crepes-sin-gluten-y-sin-lactosa-66216.html', 'Crepes sin gluten y sin lactosa'),
    ('https://www.recetasgratis.net/receta-de-rollitos-de-primavera-veganos-67505.html', 'Rollitos de primavera veganos'),
    ('https://www.recetasgratis.net/receta-de-alubias-con-tomate-57449.html', 'Alubias con tomate'),
    ('https://www.recetasgratis.net/receta-de-pudin-de-pina-al-horno-64677.html', 'Pudin de piña al horno'),
    ('https://www.recetasgratis.net/receta-de-pastel-de-patata-vegano-62820.html', 'Pastel de patata vegano'),
    ('https://www.recetasgratis.net/receta-de-frutas-de-mazapan-57080.html', 'Frutas de mazapán'),
    ('https://www.recetasgratis.net/receta-de-brocoli-salteado-con-jamon-64139.html', 'Brócoli salteado con jamón'),
    ('https://www.recetasgratis.net/receta-de-salsa-aurora-25783.html', 'Salsa aurora'),
    ('https://www.recetasgratis.net/receta-de-huevos-rellenos-con-bechamel-71609.html', 'Huevos rellenos con bechamel'),
    ('https://www.recetasgratis.net/receta-de-gofres-de-calabaza-fit-63792.html', 'Gofres de calabaza fit'),
    ('https://www.recetasgratis.net/receta-de-mayonesa-de-leche-70691.html', 'Mayonesa de leche'),
    ('https://www.recetasgratis.net/receta-de-tian-de-verduras-70627.html', 'Tian de verduras'),
    ('https://www.recetasgratis.net/receta-de-tempeh-agridulce-70097.html', 'Tempeh agridulce'),
    ('https://www.recetasgratis.net/receta-de-profiteroles-sin-gluten-70719.html', 'Profiteroles sin gluten'),
    ('https://www.recetasgratis.net/receta-de-tarta-de-maracuya-51945.html', 'Tarta de maracuya'),
    ('https://www.recetasgratis.net/receta-de-arepas-de-maiz-al-horno-65002.html', 'Arepas de maíz al horno'),
    ('https://www.recetasgratis.net/receta-de-rape-a-la-americana-38558.html', 'Rape a la americana'),
    ('https://www.recetasgratis.net/receta-de-pescadilla-con-hinojo-62889.html', 'Pescadilla con hinojo'),
    ('https://www.recetasgratis.net/receta-de-torta-bombon-suizo-23766.html', 'Torta bombon suizo'),
    ('https://www.recetasgratis.net/receta-de-soldaditos-de-pavia-27670.html', 'Soldaditos de pavia'),
    ('https://www.recetasgratis.net/receta-de-panellets-de-almendra-71255.html', 'Panellets de almendra'),
    ('https://www.recetasgratis.net/receta-de-arroz-con-huevo-revuelto-64255.html', 'Arroz con huevo revuelto'),
    ('https://www.recetasgratis.net/receta-de-esparragos-trigueros-en-salsa-66658.html', 'Esparragos trigueros en salsa'),
    ('https://www.recetasgratis.net/receta-de-pizza-de-coliflor-crujiente-66996.html', 'Pizza de coliflor crujiente'),
    ('https://www.recetasgratis.net/receta-de-perro-salado-10859.html', 'Perro salado'),
    ('https://www.recetasgratis.net/receta-de-dulce-de-leche-vegano-67626.html', 'Dulce de leche vegano'),
    ('https://www.recetasgratis.net/receta-de-canastas-de-patacon-55457.html', 'Canastas de patacon'),
    ('https://www.recetasgratis.net/receta-de-ensalada-de-quinoa-vegana-65793.html', 'Ensalada de quinoa vegana'),
    ('https://www.recetasgratis.net/receta-de-mojo-rojo-canario-hervido-70353.html', 'Mojo rojo canario hervido'),
    ('https://www.recetasgratis.net/receta-de-sopa-riojana-65653.html', 'Sopa riojana'),
    ('https://www.recetasgratis.net/receta-de-tabule-de-quinoa-y-garbanzos-63426.html', 'Tabule de quinoa y garbanzos'),
    ('https://www.recetasgratis.net/receta-de-berenjenas-fritas-51391.html', 'Berenjenas fritas')
) as v(url, titulo)
where r.url = v.url and r.title ~ '^\s*[¡¿]';

-- "¿Cómo hacer pollo en salsa de almendras?" -> "Pollo en salsa de almendras"
update recetas set title = upper(left(x.t, 1)) || substr(x.t, 2)
from (
    select id, regexp_replace(title,
        '^\s*¿\s*(c[oó]mo (hacer|preparar|cocinar)|cocinar|preparar)\s+((un|una|el|la|unos|unas)\s+)?((delicios[oa]s?|ric[oa]s?)\s+)?(.*?)\s*\?\s*$',
        '\7', 'i') as t
    from recetas where title ~ '^\s*¿' and not propia
) x
where recetas.id = x.id and x.t <> '' and x.t !~ '^\s*¿';

-- 3. Tipo de plato -----------------------------------------------------------
update recetas set tipo = sub.tipo
from (
    select id, case
        when t ~ '\y(batidos?|malteadas?|smoothies?|cocteles?|coctel|licor(es)?|limonadas?|mojitos?|sangrias?|daiquiris?|ponche|horchata|granizados?|frappes?|infusion(es)?|kombucha|cafe (helado|frio|con)|chocolate caliente|leche de (almendras?|avena|soja|arroz|coco|tigre)|agua de|bebidas?|tragos?|vermut|gin tonic|caipirinha|pina colada|margaritas?|tinto de verano|lassi|chai|cafe|te (verde|negro|chai|helado|frio|de)|tisanas?|vodka|tequila|whisky|destornillador|canelazo|atole|chucula|champurrado|(fresa|pina|coco) colada|cuba libre|kalimotxo|caipiroska|aguas? frescas?|chicha)\y|^(zumo|jugo|cafe|te)\y' then 'bebida'
        when t ~ '\y(halloween|terrorific\w*|san valentin|navidad|navidenos?|navidenas?|nochebuena|nochevieja|reyes|roscon|cumpleanos|fiesta|monstruos?|zombies?|bruja|fantasmas?|calabaza de halloween)\y' then 'ocasion'
        when t ~ '\y(tartas?|pastel(es|itos?)?|bizcochos?|bizcochitos?|galletas?|cookies?|brownies?|blondies?|helados?|flan(es)?|natillas?|mousse|cupcakes?|muffins?|magdalenas?|budin(es)?|pudin(es)?|alfajor(es)?|rosquillas?|rosquitos?|churros?|tiramisu|cheesecake|mermeladas?|compotas?|confituras?|merengues?|turron(es)?|mazapan(es)?|polvoron(es)?|trufas de|bombon(es)?|caramel\w*|dulces?|arroz con leche|torrijas?|panqueques?|tortitas|gofres?|waffles?|profiteroles?|coulant|panna cotta|sorbetes?|macedonia|glaseado|ganache|crema pastelera|crema catalana|postres?|donuts?|donas|palmeras de|petit|chocolate|chocolatinas?|bombas de|budines|crepes? (dulces?|de (chocolate|nutella|fresas?|platano|frutas?|nata|manzana))|bunuelos de viento|leche frita|leche asada|cuajada|yogur(es)?|granola|porridge|gachas de avena|overnight|bolleria|croissants?|cruasanes|ensaimadas?|coca de (llardons|san juan|crema)|flan|frutas? (en almibar|confitadas?)|almibar|tejas|carquinyolis|barquillos|frutos rojos|fresas con|manzanas? asadas?|peras? al vino|crumble|strudel|baklava|brazo de gitano|milhojas|sacher|selva negra|red velvet|banoffee|lemon pie|pie de|pan de (banana|platano|calabaza|naranjas?|especias|muerto|jengibre|elote)|bizcochuelos?|sabayon|gelatinas?|crema de mantequilla|roscas?|roscos?|rosquetes?|pestinos?|bunuelos|filloas dulces|crema de (pina|limon|chocolate|cafe|fresas?|vainilla|mango|coco|naranja|platano|frutas?|avellanas?|cacao)|queque|kuchen|lemon curd|semifrio|tocino de cielo|yemas|cocadas?|pionono|torta (de )?(chocolate|tres leches|de zanahoria|de manzana|de queso)|tres leches|mazamorra|majarete|arequipe|cajeta|dulce de)\y' and t !~ '\y(pollo|carne|ternera|cerdo|atun|salmon|bacalao|merluza|pescado|jamon|bacon|panceta|verduras?|puerros?|espinacas?|cebolla|calabacin|berenjenas?|pimientos?|champinon(es)?|setas|patatas?|papas?|choclo|marisco|gambas|langostinos|chorizo|morcilla|pavo|salada|saladas|esparragos|alcachofas?|brocoli|coliflor|acelgas?|lentejas|garbanzos|anchoas|sardinas|queso de cabra|roquefort|cabrales|carne picada)\y' then 'dulce'
        when t ~ '^(salsas?|aderezos?|vinagretas?|mayonesas?|alioli|allioli|ali oli|chimichurri|pesto|mojo|pebre|adobo|marinada|bechamel|besamel|sofrito|ketchup|mostaza|reduccion|crema de leche|masa|masas|base|bases|fondo|fondos|caldo (casero|basico|para|de huesos)|como|manera|mantequilla|ghee|harina|levadura|pan rallado|picada|salmuera|caramelo|dulce de leche|cobertura|relleno|almibar|glaseado|nata montada|crema chantilly|queso (vegano|crema casero)|leche condensada|tahini|tahin|curry en polvo|especias|pasta de (curry|ajo|tomate|pimiento)|guarnicion)\y' then 'salsa'
        when t ~ '\y(tapas?|canapes?|dips?|hummus|humus|montaditos?|pinchos?|aperitivos?|bruschettas?|tostas?|crostinis?|guacamole|pates?|snacks?|bocaditos?|nachos|chips|palomitas|tequenos?|volovanes|vol au vent|crackers|banderillas?|tartaletas?|crudites|tapenade|baba ganoush|muhammara|tzatziki|tostaditas?|bolitas de|brochetas de frutas|patatas bravas|bravas|chupitos?|mini|piruletas de|rollitos de primavera|pan con tomate|pan tostado|tostadas? con)\y|^aceitunas\y' then 'aperitivo'
        when t ~ '^(pan|panes|panecillos?|focaccias?|bollos?|brioche|baguettes?|chapata|ciabatta|pitas?|naan|bagels?|grisines|picos|reganas|scones|colines|hogaza|chapati|pretzels?|buttermilk scones|mojicones)\y(?! (de carne|relleno|de (jamon|pollo|atun)))' then 'pan'
        else 'principal' end as tipo
    from (select id, translate(lower(title), 'ÁÉÍÓÚÜÀÈÌÒÙÑáéíóúüàèìòùñ', 'aeiouuaeiounaeiouuaeioun') as t from recetas where not propia) x
) sub
where recetas.id = sub.id;
update recetas set tipo = 'principal' where tipo is null;

-- 4. Categorías --------------------------------------------------------------
insert into categoria_recetas (categoria)
select v.c from (values ('Legumbres'), ('Arroces'), ('Verduras'), ('Huevos'), ('Pizzas y bocadillos'), ('Aperitivos'), ('Panes'), ('Salsas y bases'), ('Bebidas')) as v(c)
where not exists (select 1 from categoria_recetas where lower(categoria) = lower(v.c));

update recetas set categoria = c.id
from (
    select id, case
        when tipo = 'dulce' then 'Postres'
        when tipo = 'bebida' then 'Bebidas'
        when tipo = 'salsa' then 'Salsas y bases'
        when tipo = 'aperitivo' then 'Aperitivos'
        when tipo = 'pan' then 'Panes'
        when t ~ '\y(lentejas?|garbanzos?|alubias?|judias (blancas|pintas|rojas|negras)|fabada|fabes|frijol(es)?|porotos?|potajes?|cocido|habichuelas|edamame|soja texturizada|dal|chili con carne|michirones|empedrat)\y' then 'Legumbres'
        when t ~ '\y(arroz|arroces|paellas?|risotto|risottos|arrocito|arros|pilaf|biryani|onigiri|sushi|poke|chaufa)\y' then 'Arroces'
        when t ~ '\y(espaguetis?|spaghetti|macarron(es)?|pastas?|tallarin(es)?|lasanas?|lasagna|noquis?|gnocchis?|fideos?|fideua|canelon(es)?|raviolis?|ravioles|tortellinis?|rigatoni|penne|tagliatelles?|fettuccinis?|fetuccini|carbonara|linguini|farfalle|fusilli|orzo|ramen|udon|soba|pad thai|yakisoba|noodles|cuscus|couscous)\y' then 'Pastas'
        when t ~ '\y(sopas?|consomes?|gazpachos?|salmorejos?|vichyssoise|caldos?|minestrone|ajoblanco|porrusalda|caldereta|bullabesa|zurrukutuna|veloute)\y|^(cremas?|crema fria|pures?|cremita)\y' then 'Sopas y Cremas'
        when t ~ '\y(ensaladas?|ensaladillas?|tabule|tabbouleh|cogollos|carpaccio de (calabacin|tomate)|pipirrana|esqueixada|remojon|empedrat|coleslaw)\y' then 'Ensaladas'
        when t ~ '\y(pizzas?|empanadas?|empanadillas?|bocadillos?|sandwich(es)?|sandwiches|hamburguesas?|perritos?|hot dogs?|tacos?|burritos?|quesadillas?|fajitas?|wraps?|kebab|shawarma|durum|pitas rellenas|arepas?|calzone|coca de|cocas|flautas|enchiladas?|tostadas|molletes?|croque|panini|bikini|mollete)\y' then 'Pizzas y bocadillos'
        when t ~ '\y(pescados?|atun|salmon|merluza|bacalao|gambas?|langostinos?|calamar(es)?|chipirones|mariscos?|marisqueria|pulpo|mejillon(es)?|almejas?|sepia|chocos|lubina|dorada|anchoas?|boqueron(es)?|sardinas?|rape|surimi|bonito|abadejo|berberechos?|cangrejos?|centolla|ostras?|camaron(es)?|bogavante|langosta|cigalas?|navajas|zamburinas|vieiras|caballa|jurel|trucha|lenguados?|rodaballo|gallo|bacaladitos|pescadilla|panga|tilapia|corvina|pez espada|emperador|mero|besugo|cazon|rosada|txangurro|kokotxas|cebiches?|ceviches?|pulpitos|carabineros|percebes|erizos|marmitako|zarzuela|chanquetes)\y' then 'Pescados y Mariscos'
        when t ~ '\y(pollo|pechugas?|muslos?|contramuslos?|alitas|alas de pollo|ternera|cerdo|carnes?|jamon|bacon|beicon|lomo|pavo|solomillos?|costillas?|costillar|buey|cordero|albondigas?|chorizo|morcilla|conejo|pato|magret|secreto|presa|pluma|panceta|bistecs?|filetes?|escalopes?|rabo|carrilladas?|codillo|chuletas?|chuleton|entrecot|cachopo|flamenquin(es)?|san jacobos?|salchichas?|longaniza|butifarra|picadillo|osobuco|churrasco|asado|milanesas?|codorniz|codornices|perdiz|morcillo|redondo|aguja|lacon|sobrasada|higado|callos|manitas|oreja|lengua|rinones|mollejas|cabrito|lechazo|cochinillo|vacio|matambre|bondiola|entrana|bife|res|mondongo|ropa vieja|pulled pork|carrillera|gallina|capon|ganso|faisan|jabali|venado|ciervo|liebre|chili)\y' then 'Carnes'
        when t ~ '\y(huevos?|tortillas? de|tortilla|revueltos?|frittata|quiches?|shakshuka|pisto con huevo|duelos y quebrantos|huevos rotos|flamenca)\y' then 'Huevos'
        when t ~ '\y(verduras?|vegetales|berenjenas?|calabacin(es)?|pimientos?|espinacas?|acelgas?|brocoli|coliflor|judias verdes|alcachofas?|champinon(es)?|setas|hongos|boletus|patatas?|papas|pisto|menestra|esparragos|puerros?|calabaza|coles|col|repollo|lombarda|zanahorias?|tofu|seitan|tempeh|veganos?|veganas?|vegetarian[oa]s?|guisantes|berza|ratatouille|tomates rellenos|cebollas|alcachofa|nabos|chirivia|remolacha|batatas?|boniatos?|yuca|quinoa|hamburguesa vegetal|falafel|pimientos rellenos|escalivada|samfaina|tumbet|parrillada de verduras|wok)\y' then 'Verduras'
        else null end as nombre
    from (select id, tipo, translate(lower(title), 'ÁÉÍÓÚÜÀÈÌÒÙÑáéíóúüàèìòùñ', 'aeiouuaeiounaeiouuaeioun') as t from recetas where not propia) x
) sub
join categoria_recetas c on lower(c.categoria) = lower(sub.nombre)
where recetas.id = sub.id;

-- Principales que no encajan en ninguna regla: si tenían una categoría de "no plato"
-- (p. ej. Postres porque llevaban azúcar) se quedan sin categoría.
update recetas set categoria = null
where tipo in ('principal', 'ocasion') and not propia
  and categoria in (select id from categoria_recetas
                    where categoria in ('Postres', 'Bebidas', 'Salsas y bases', 'Aperitivos', 'Panes'));

-- 5. Ocultar duplicados y recetas vacías ------------------------------------
with usadas as (
    select receta_id from recetas_favoritas where receta_id is not null
    union select receta_id from menu_semanal_actual where receta_id is not null
    union select receta_id from semanas_guardadas where receta_id is not null
),
ranking as (
    select r.id, row_number() over (
        partition by lower(trim(r.title))
        order by (r.id in (select receta_id from usadas)) desc,
                 length(coalesce(r.steps, '')) + length(coalesce(r.ingredients, '')) desc,
                 r.id
    ) as n
    from recetas r
    where not r.propia
)
update recetas set oculta = true
from ranking
where recetas.id = ranking.id and ranking.n > 1;

update recetas set oculta = true
where not propia
  and length(coalesce(steps, '')) < 150
  and id not in (select receta_id from recetas_favoritas where receta_id is not null)
  and id not in (select receta_id from menu_semanal_actual where receta_id is not null);

commit;

-- Resumen: cuántas recetas de cada tipo y cuántas ocultas.
select tipo, count(*) as recetas, count(*) filter (where oculta) as ocultas
from recetas group by tipo order by recetas desc;
