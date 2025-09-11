const Applet = imports.ui.applet;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const AccountsService = imports.gi.AccountsService;
const GnomeSession = imports.misc.gnomeSession;
const ScreenSaver = imports.misc.screenSaver;
const Settings = imports.ui.settings;
const UserWidget = imports.ui.userWidget;
const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;
const Clutter = imports.gi.Clutter;
const Gettext = imports.gettext;
const Slider = imports.ui.slider;

const UUID = 'user@celiopy';
const APPLET_DIR = imports.ui.appletManager.appletMeta[UUID].path;
const DIALOG_ICON_SIZE = 32;

const INHIBIT_IDLE_FLAG = 8;
const INHIBIT_SLEEP_FLAG = 4;

// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class CinnamonUserApplet extends Applet.TextApplet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        // Containers do painel
        this._panel_icon_box = new St.Bin();
        this._panel_icon_box.set_alignment(St.Align.MIDDLE, St.Align.MIDDLE);
        this.actor.insert_child_at_index(this._panel_icon_box, 0);
        
        this.sessionCookie = null;
        this._panel_avatar = null;

        // Inicializa schemas, bindings, UI e toggles
        this._initSchemas();
        this._initUI(orientation);
        this._initToggles();

        // Métodos iniciais
        this._onUserChanged();
        this._setKeybinding();
    }

    // === Inicializa schemas e bindings ===
    _initSchemas() {
        // Schemas do applet
        this.settings = new Settings.AppletSettings(this, UUID, this.instance_id);
        this.settings.bind("light-theme", "_lightTheme");
        this.settings.bind("dark-theme", "_darkTheme");
        this.settings.bind("keyOpen", "keyOpen", () => this._setKeybinding());
        this.settings.bind("display-name", "disp_name", () => this._updateLabel());
        this.settings.bind("display-image", "display_image", () => this._updatePanelIcon());

        // Schemas do sistema
        this._schemas = {
            color: new Gio.Settings({ schema_id: "org.cinnamon.settings-daemon.plugins.color" }),
            interface: new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" }),
            gtk: new Gio.Settings({ schema_id: "org.gnome.desktop.interface" }),
            cinnamon: new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" }),
            portal: new Gio.Settings({ schema_id: "org.x.apps.portal" }),
            screensaver: new Gio.Settings({ schema_id: "org.cinnamon.desktop.screensaver" })
        };
    }

    // === Inicializa UI do menu e painel ===
    _initUI(orientation) {
        // Sessão
        this.sessionProxy = null;
        this._session = new GnomeSession.SessionManager(Lang.bind(this, function(proxy, error) {
            if (error) {
                global.logError("Error initializing session proxy: " + error.message);
                return;
            }
            this.sessionProxy = proxy;
            global.log("Session proxy initialized successfully");
        }));
        this._screenSaverProxy = new ScreenSaver.ScreenSaverProxy();

        // Menu
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        // Seções do menu
        this.prefsSection = new PopupMenu.PopupMenuSection();
        this.interfaceSection = new PopupMenu.PopupMenuSection();
        this.sessionSection = new PopupMenu.PopupMenuSection();

        this.menu.addMenuItem(this.prefsSection);
        this.menu.addMenuItem(this.interfaceSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.sessionSection);

        // Grid de toggles (3 colunas)
        this.prefsGrid = new St.Widget({
            layout_manager: new Clutter.GridLayout(),
            style_class: "prefs-grid-container",
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });
        let gridLayout = this.prefsGrid.layout_manager;
        gridLayout.set_column_spacing(12);
        gridLayout.set_row_spacing(16);
        gridLayout.set_column_homogeneous(true);
        this.prefsSection.actor.add_child(this.prefsGrid);

        this.maxTogglesPerRow = 3;
        this.currentRow = 0;
        this.currentColumn = 0;

        // Sessão: container horizontal
        this.sessionContainer = new St.BoxLayout({
            style_class: "session-container",
            vertical: false,
            x_expand: true
        });
        this.sessionSection.actor.add_child(this.sessionContainer);

        // User info
        this._user = AccountsService.UserManager.get_default().get_user(GLib.get_user_name());
        this._user.connect('notify::is-loaded', () => this._onUserChanged());
        this._user.connect('changed', () => this._onUserChanged());

        let userBox = new St.BoxLayout({ style_class: 'user-box', vertical: false, y_expand: false });
        // Avatar dentro de botão
        this._userButton = new St.Button({
            style_class: "user-avatar-button",
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        // Coloca o avatar dentro do botão
        this._userIcon = new UserWidget.Avatar(this._user, { iconSize: DIALOG_ICON_SIZE });
        this._userButton.set_child(this._userIcon);

        // Adiciona o botão no userBox
        userBox.add(this._userButton);

        // Clique no avatar abre "Detalhes da conta"
        this._userButton.connect('clicked', () => {
            Util.spawnCommandLine("cinnamon-settings user");
        });

        let labelBox = new St.BoxLayout({ style_class: 'label-box', vertical: true, y_align: Clutter.ActorAlign.CENTER });
        this.userLabel = new St.Label({ style_class: 'user-label' });
        this.hostLabel = new St.Label({ style_class: 'host-label' });
        labelBox.add(this.userLabel);
        labelBox.add(this.hostLabel);
        userBox.add(labelBox);

        // Adiciona user info e spacer
        this.sessionContainer.add_child(userBox);
        this.sessionContainer.add_child(new St.BoxLayout({ x_expand: true })); // Spacer

        // Session buttons
        this.sessionButtonsBox = new St.BoxLayout({ style_class: 'session-buttons-box', vertical: false, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER });
        this.sessionContainer.add_child(this.sessionButtonsBox);

        this._initSessionButtons();
    }

    // === Inicializa session buttons ===
    _initSessionButtons() {
        const addBtn = (iconName, tooltip, callback) => {
            let btn = new St.Button({ style_class: "system-button", reactive: true, can_focus: true, track_hover: true });
            let icon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, style_class: "system-status-icon" });
            btn.set_child(icon);
            new Tooltips.Tooltip(btn, tooltip);
            btn.connect("clicked", callback);
            this.sessionButtonsBox.add_child(btn);
        };

        // System Settings
        addBtn("gnome-system-symbolic", _("Settings"), () => {
            Util.spawnCommandLine("cinnamon-settings");
        });

        // Lock
        addBtn("system-lock-screen", _("Lock Screen"), () => {
            let screensaver_file = Gio.file_new_for_path("/usr/bin/cinnamon-screensaver-command");
            if (screensaver_file.query_exists(null)) {
                let ask = this._schemas.screensaver.get_boolean("ask-for-away-message");
                Util.spawnCommandLine(ask ? "cinnamon-screensaver-lock-dialog" : "cinnamon-screensaver-command --lock");
            } else {
                this._screenSaverProxy.LockRemote();
            }
        });

        // Logout
        addBtn("system-log-out", _("Log Out"), () => this._session.LogoutRemote(0));

        // Shutdown
        addBtn("system-shutdown", _("Shut Down"), () => this._session.ShutdownRemote());
    }

    // === Inicializa toggles do applet ===
    _initToggles() {
        // Dark Mode (applet setting)
        this.darkModeToggle = this._createToggle(
            "weather-clear-night-symbolic",
            _("Dark mode"),
            this.settings,
            "dark-mode",
            (newValue) => this._setDarkMode(newValue)
        );
        this._addToggleToGrid(this.darkModeToggle.actor);

        // Night Light (Gio.Settings)
        this.nightLightToggle = this._createToggle(
            "night-light-symbolic",
            _("Night Light"),
            this._schemas.color,
            "night-light-enabled"
        );
        this._addToggleToGrid(this.nightLightToggle.actor);

        // Prevent Sleep toggle
        this.preventSleepToggle = this._createToggle(
            "preferences-desktop-screensaver-symbolic",
            _("Prevent Sleep"),
            null,
            null,
            (active) => this._togglePreventSleep(active)
        );
        this._addToggleToGrid(this.preventSleepToggle.actor);

        // Text scaling slider
        this._initTextScaling();
    }

    // === Cria toggle com container extra para botão ===
    _createToggle(iconName, labelText, settingsObj = null, settingsKey = null, onChange = null) {
        let toggleBox = new St.BoxLayout({ vertical: true, style_class: "settings-toggle-box", x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: false, y_expand: false });
        let buttonContainer = new St.BoxLayout({ style_class: "settings-toggle-icon-container", x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });

        let button = new St.Button({ style_class: "settings-toggle-button", reactive: true, can_focus: true, track_hover: true, toggle_mode: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: false, y_expand: false });
        let icon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, style_class: "settings-toggle-icon" });

        button.set_child(icon);
        buttonContainer.add_child(button);
        toggleBox.add_child(buttonContainer);

        let label = new St.Label({ text: labelText, style_class: "settings-toggle-label", x_align: Clutter.ActorAlign.CENTER });
        toggleBox.add_child(label);

        if (settingsObj && settingsKey) {
            const updateState = () => {
                let value = (settingsObj instanceof Gio.Settings) ? settingsObj.get_boolean(settingsKey) : settingsObj.getValue(settingsKey);
                button.checked = value;
                if (value) button.add_style_class_name("active"); else button.remove_style_class_name("active");
            };
            updateState();

            if (settingsObj instanceof Gio.Settings) {
                settingsObj.connect(`changed::${settingsKey}`, updateState);
            } else if (settingsObj instanceof Settings.AppletSettings) {
                settingsObj.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, settingsKey, "_dummy", updateState, null);
            }
        }

        // MOVE THE CLICKED HANDLER OUTSIDE THE if BLOCK
        // So it works for both settings-based and custom toggles
        button.connect("clicked", () => {
            let newValue;
            if (settingsObj && settingsKey) {
                // Settings-based toggle
                let current = (settingsObj instanceof Gio.Settings) ? settingsObj.get_boolean(settingsKey) : settingsObj.getValue(settingsKey);
                newValue = !current;
                if (settingsObj instanceof Gio.Settings) settingsObj.set_boolean(settingsKey, newValue);
                else settingsObj.setValue(settingsKey, newValue);
            } else {
                // Custom toggle: manually flip
                newValue = !button._activeState;
                button._activeState = newValue; // store state manually
            }

            if (onChange) onChange(newValue);
        });

        return { actor: toggleBox, button, icon, label };
    }

    // === Adiciona toggle ao grid ===
    _addToggleToGrid(toggleActor) {
        let gridLayout = this.prefsGrid.layout_manager;
        gridLayout.attach(toggleActor, this.currentColumn, this.currentRow, 1, 1);
        this.currentColumn++;
        if (this.currentColumn >= this.maxTogglesPerRow) {
            this.currentColumn = 0;
            this.currentRow++;
        }
    }

    // === Inicializa slider de text scaling ===
    _initTextScaling() {
        const FACTORS = [0.9, 1.0, 1.1, 1.2, 1.3];
        const MAX_INDEX = FACTORS.length - 1;

        let currentFactor = this._schemas.interface.get_double("text-scaling-factor");
        let idx = FACTORS.indexOf(currentFactor);
        if (idx < 0) idx = 1;

        // Container do slider
        let fakeSlider = new St.BoxLayout({
            style_class: "fake-slider",
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.FILL
        });

        // Track em grid
        let track = new St.Widget({
            style_class: "fake-slider-track",
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.GridLayout()
        });
        let grid = track.layout_manager;
        grid.set_row_homogeneous(true);
        grid.set_column_homogeneous(true);

        // Fill do slider
        let fill = new St.BoxLayout({ style_class: "fake-slider-fill" });

        // Atualiza fill conforme índice
        const updateFakeSlider = (idx) => {
            track.remove_all_children();

            let weight = (idx + 1);

            // Fill ocupa "weight" colunas
            track.add_child(fill);
            grid.attach(fill, 0, 0, weight, 1);

            // Spacer ocupa o resto
            if (weight < FACTORS.length) {
                let spacer = new St.BoxLayout({ x_expand: true });
                track.add_child(spacer);
                grid.attach(spacer, weight, 0, FACTORS.length - weight, 1);
            }

            // === Marcador fixo no 1.0 ===
            let markerIndex = FACTORS.indexOf(1.0);
            if (markerIndex >= 0) {
                let marker = new St.BoxLayout({
                    style_class: "fake-slider-marker",
                    x_expand: false,
                    y_expand: false,
                    x_align: Clutter.ActorAlign.END
                });
                track.add_child(marker);
                grid.attach(marker, markerIndex, 0, 1, 1);
            }
        };
        
        fakeSlider.add_child(track);

        // Função para alterar escala
        const setScale = (newIdx) => {
            newIdx = Math.max(0, Math.min(MAX_INDEX, newIdx));
            idx = newIdx;
            let factor = FACTORS[idx];
            this._schemas.interface.set_double("text-scaling-factor", factor);
            updateFakeSlider(idx);
        };

        // Escuta mudanças externas do text-scaling-factor
        this._schemas.interface.connect("changed::text-scaling-factor", () => {
            let f = this._schemas.interface.get_double("text-scaling-factor");
            let i = FACTORS.indexOf(f);
            if (i >= 0) {
                idx = i;
                updateFakeSlider(idx);
            }
        });

        // Botões de menos/mais
        let minusBtn = new St.Button({ style_class: "system-button", reactive: true, can_focus: true, track_hover: true });
        minusBtn.set_child(new St.Icon({ icon_name: 'format-text-rich-symbolic', icon_type: St.IconType.SYMBOLIC, style_class: "system-status-icon" }));
        minusBtn.connect("clicked", () => setScale(idx - 1));

        let plusBtn = new St.Button({ style_class: "system-button icon-large", reactive: true, can_focus: true, track_hover: true });
        plusBtn.set_child(new St.Icon({ icon_name: 'list-add-symbolic', icon_type: St.IconType.SYMBOLIC, style_class: "system-status-icon" }));
        plusBtn.connect("clicked", () => setScale(idx + 1));

        // Container final
        let scalingContainer = new St.BoxLayout({ style_class: "scaling-container", vertical: false, x_expand: true });
        scalingContainer.add_child(minusBtn);
        scalingContainer.add_child(fakeSlider);
        scalingContainer.add_child(plusBtn);

        this.interfaceSection.actor.add_child(scalingContainer);

        updateFakeSlider(idx);
    }

    // === Dark mode ===
    _setDarkMode(dark) {
        let theme = dark ? this._darkTheme : this._lightTheme;
        let colorScheme = dark ? "prefer-dark" : "default";

        this._schemas.gtk.set_string("gtk-theme", theme);
        this._schemas.cinnamon.set_string("gtk-theme", theme);
        this._schemas.portal.set_string("color-scheme", colorScheme);

        this._darkMode = dark;
    }

    // === Toggle Prevent Sleep ===
    _togglePreventSleep(active) {
        if (active) {
            // Activate prevent sleep
            this.sessionProxy.InhibitRemote(
                "inhibit@cinnamon.org",
                0,
                "prevent system sleep and suspension",
                INHIBIT_SLEEP_FLAG,
                Lang.bind(this, function(cookie) {
                    this.sessionCookie = cookie;
                    global.log("Prevent sleep activated, cookie: " + cookie);
                    // Ensure UI reflects the active state
                    this.preventSleepToggle.button.checked = true;
                })
            );
        } else if (this.sessionCookie) {
            // Deactivate prevent sleep
            this.sessionProxy.UninhibitRemote(
                this.sessionCookie, 
                Lang.bind(this, function() {
                    global.log("Prevent sleep deactivated");
                    this.sessionCookie = null;
                    // Ensure UI reflects the inactive state
                    this.preventSleepToggle.button.checked = false;
                })
            );
        } else {
            // No cookie to uninhibit, just update UI
            this.preventSleepToggle.button.checked = false;
        }
    }

    // === Keybinding ===
    _setKeybinding() {
        if (this.keybindingId) {
            Main.keybindingManager.removeHotKey("user-applet-open-" + this.instance_id);
        }
        Main.keybindingManager.addHotKey("user-applet-open-" + this.instance_id, this.keyOpen, () => this._openMenu());
    }

    _openMenu() { this.menu.toggle(); }

    // === Atualiza labels e avatar ===
    _updateLabel() {
        if (this.disp_name) {
            this.set_applet_label(this._user.get_real_name());
            this._layoutBin.show();
        } else {
            this.set_applet_label("");
            this._layoutBin.hide();
        }
    }

    _updatePanelIcon() {
        if (this.display_image) {
            if (this._panel_avatar != null) {
                this._panel_avatar.destroy();
            }

            this._panel_avatar = new UserWidget.Avatar(this._user, { iconSize: this.getPanelIconSize(St.IconType.FULLCOLOR) });
            this._panel_icon_box.set_child(this._panel_avatar);
            this._panel_avatar.update();
            this._panel_avatar.show();
        } else {
            if (this._panel_icon) this._panel_icon.destroy();

            this._panel_icon = new St.Icon({
                icon_name: "user-menu-symbolic",
                icon_type: St.IconType.SYMBOLIC,
                icon_size: this.getPanelIconSize(St.IconType.SYMBOLIC),
                style_class: "custom-panel-icon"
            });

            this._panel_icon_box.set_child(this._panel_icon);
        }
    }

    _onUserChanged() {
        if (this._user && this._user.is_loaded) {
            this.set_applet_tooltip(this._user.get_real_name());
            let hostname = GLib.get_host_name();
            this.hostLabel.set_text(`${GLib.get_user_name()}@${hostname}`);
            this.userLabel.set_text(this._user.get_real_name());
            this._userIcon.update();

            this._updatePanelIcon();
            this._updateLabel();
        }
    }

    on_applet_clicked() { this.menu.toggle(); }

    on_applet_removed_from_panel() {
        // Clean up inhibit cookie if active - FIXED variable name
        if (this.sessionCookie !== null && this.sessionProxy) {
            try {
                this.sessionProxy.UninhibitRemote(this.sessionCookie);
                global.log("Cleaned up prevent sleep cookie: " + this.sessionCookie);
            } catch(e) {
                global.logError("Erro ao limpar inhibit cookie: " + e);
            }
        }
        this.settings.finalize();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CinnamonUserApplet(orientation, panel_height, instance_id);
}