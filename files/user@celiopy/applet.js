const Applet = imports.ui.applet;
const Lang = imports.lang;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const AccountsService = imports.gi.AccountsService;
const GnomeSession = imports.misc.gnomeSession;
const ScreenSaver = imports.misc.screenSaver;
const Settings = imports.ui.settings;
const FileUtils = imports.misc.fileUtils;
const UserWidget = imports.ui.userWidget;
const Main = imports.ui.main;

const DIALOG_ICON_SIZE = 64;
const USER_DEFAULT_IMG_PATH = "/usr/share/cinnamon/faces/user-generic.png";

class CinnamonUserApplet extends Applet.TextApplet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        this._panel_icon_box = new St.Bin();
        this._panel_icon_box.set_alignment(St.Align.MIDDLE, St.Align.MIDDLE);
        this.actor.insert_child_at_index(this._panel_icon_box, 0);

        this._panel_avatar = null;

        this._session = new GnomeSession.SessionManager();
        this._screenSaverProxy = new ScreenSaver.ScreenSaverProxy();
        this.settings = new Settings.AppletSettings(this, "user@celiopy", instance_id);

        // Load settings
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
            "dark-mode",
            "_darkMode",
            this.on_settings_changed,
            null);
        this.settings.bind("light-theme", "_lightTheme");
        this.settings.bind("dark-theme", "_darkTheme");

        this.settings.bind("keyOpen", "keyOpen", this._setKeybinding);
        this._setKeybinding();

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._contentSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._contentSection);

        this._user = AccountsService.UserManager.get_default().get_user(GLib.get_user_name());
        this._userLoadedId = this._user.connect('notify::is-loaded', Lang.bind(this, this._onUserChanged));
        this._userChangedId = this._user.connect('changed', Lang.bind(this, this._onUserChanged));

        let userBox = new St.BoxLayout({ style_class: 'user-box', reactive: true, vertical: false });

        this._userIcon = new UserWidget.Avatar(this._user, { iconSize: DIALOG_ICON_SIZE });

        this.settings.bind("display-name", "disp_name", this._updateLabel);
        this.settings.bind("display-image", "display_image", this._updatePanelIcon);

        userBox.connect('button-press-event', Lang.bind(this, function() {
            this.menu.toggle();
            Util.spawnCommandLine("cinnamon-settings user");
        }));

        this._userIcon.hide();
        userBox.add(this._userIcon,
                    { x_fill:  false,
                      y_fill:  true,
                      x_align: St.Align.MIDDLE,
                      y_align: St.Align.START });

        let labelBox = new St.BoxLayout({ style_class: 'label-box', vertical: true });
        this.userLabel = new St.Label(({ style_class: 'user-label'}));
        labelBox.add(this.userLabel,
                    { x_fill:  false,
                      y_fill:  false,
                      x_align: St.Align.START,
                      y_align: St.Align.MIDDLE });
        this.hostLabel = new St.Label(({ style_class: 'host-label'}));
        labelBox.add(this.hostLabel,
                    { x_fill:  false,
                      y_fill:  false,
                      x_align: St.Align.MIDDLE,
                      y_align: St.Align.MIDDLE });
        userBox.add(labelBox,
                    { x_fill:  false,
                      y_fill:  false,
                      x_align: St.Align.END,
                      y_align: St.Align.MIDDLE });

        this.menu.addActor(userBox);

        // Create the dark mode switch
        this.darkModeItem = new PopupMenu.PopupSwitchMenuItem(_("Dark mode"), this._darkMode);
        this.darkModeItem.connect('toggled', Lang.bind(this, this.on_change_theme));
        this.menu.addActor(this.darkModeItem.actor, {
            x_fill: false,
            y_fill: false,
            x_align: St.Align.END,
            y_align: St.Align.MIDDLE
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let item = new PopupMenu.PopupIconMenuItem(
            _("System Settings"), 
            "preferences-system", 
            St.IconType.SYMBOLIC
        );
        item.connect('activate', Lang.bind(this, function() {
            Util.spawnCommandLine("cinnamon-settings");
        }));
        this.menu.addMenuItem(item);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        item = new PopupMenu.PopupIconMenuItem(_("Lock Screen"), "system-lock-screen", St.IconType.SYMBOLIC);
        item.connect('activate', Lang.bind(this, function() {
            let screensaver_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.screensaver" });
            let screensaver_dialog = Gio.file_new_for_path("/usr/bin/cinnamon-screensaver-command");
            if (screensaver_dialog.query_exists(null)) {
                if (screensaver_settings.get_boolean("ask-for-away-message")) {
                    Util.spawnCommandLine("cinnamon-screensaver-lock-dialog");
                }
                else {
                    Util.spawnCommandLine("cinnamon-screensaver-command --lock");
                }
            }
            else {
                this._screenSaverProxy.LockRemote();
            }
        }));
        this.menu.addMenuItem(item);

        let lockdown_settings = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.lockdown' });
        if (!lockdown_settings.get_boolean('disable-user-switching')) {
            if (GLib.getenv("XDG_SEAT_PATH")) {
                item = new PopupMenu.PopupIconMenuItem(_("Switch User"), "system-switch-user", St.IconType.SYMBOLIC);
                item.connect('activate', Lang.bind(this, function() {
                    Util.spawnCommandLine("cinnamon-screensaver-command --lock");
                    Util.spawnCommandLine("dm-tool switch-to-greeter");
                }));
                this.menu.addMenuItem(item);
            }
            else if (GLib.file_test("/usr/bin/mdmflexiserver", GLib.FileTest.EXISTS)) {
                item = new PopupMenu.PopupIconMenuItem(_("Switch User"), "system-switch-user", St.IconType.SYMBOLIC);
                item.connect('activate', Lang.bind(this, function() {
                    Util.spawnCommandLine("mdmflexiserver");
                }));
                this.menu.addMenuItem(item);
            }
            else if (GLib.file_test("/usr/bin/gdmflexiserver", GLib.FileTest.EXISTS)) {
                item = new PopupMenu.PopupIconMenuItem(_("Switch User"), "system-switch-user", St.IconType.SYMBOLIC);
                item.connect('activate', Lang.bind(this, function() {
                    Util.spawnCommandLine("cinnamon-screensaver-command --lock");
                    Util.spawnCommandLine("gdmflexiserver");
                }));
                this.menu.addMenuItem(item);
            }
        }

        item = new PopupMenu.PopupIconMenuItem(_("Log Out..."), "logout", St.IconType.SYMBOLIC);
        item.connect('activate', Lang.bind(this, function() {
            this._session.LogoutRemote(0);
        }));
        this.menu.addMenuItem(item);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        item = new PopupMenu.PopupIconMenuItem(_("Power Off..."), "system-shutdown", St.IconType.SYMBOLIC);
        item.connect('activate', Lang.bind(this, function() {
            this._session.ShutdownRemote();
        }));
        this.menu.addMenuItem(item);

        // Load and set theme options
        this._populateThemeOptions();

        // Monitor theme directories
        this._monitorThemeDirectories();
        this._onUserChanged();
    }

    _monitorThemeDirectories() {
        const themeDirs = [
            '/usr/share/themes',
            GLib.get_home_dir() + '/.themes'
        ];

        themeDirs.forEach(dir => {
            let file = Gio.file_new_for_path(dir);
            let monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);

            monitor.connect('changed', (monitor, file, other_file, event_type) => {
                // Repopulate themes when a change is detected
                this._populateThemeOptions();
            });
        });
    }

    _populateThemeOptions() {
        let themes = {};
        
        const readThemesFromDir = (dir) => {
            try {
                let file = Gio.file_new_for_path(dir);
                let enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);

                let info;
                while ((info = enumerator.next_file(null))) {
                    let themeName = info.get_name();
                    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                        themes[themeName] = themeName;  // Use theme name as both key and value
                    }
                }
            } catch (e) {
                log(`Error reading themes from ${dir}: ${e.message}`);
            }
        };

        // Read themes from both system and user directories
        readThemesFromDir('/usr/share/themes');
        readThemesFromDir(GLib.get_home_dir() + '/.themes');

        // Clear existing options in the ComboBox (assuming you have a ComboBox defined)
        this._clearComboBoxOptions();

        // Add new options to the ComboBox
        for (let theme in themes) {
            this._addComboBoxOption(theme, theme); // Add each theme to the ComboBox
        }

        // Log found themes
        if (Object.keys(themes).length === 0) {
            log("No themes found.");
        } else {
            log(`Found themes: ${JSON.stringify(themes)}`);
        }

        // Set the options for light and dark themes
        this.settings.setOptions("light-theme", themes);
        this.settings.setOptions("dark-theme", themes);
    }

    _clearComboBoxOptions() {
        // Clear the ComboBox options
        // Assuming you have a reference to your ComboBox, for example:
        if (this.lightThemeComboBox) {
            this.lightThemeComboBox.remove_all();
        }
        if (this.darkThemeComboBox) {
            this.darkThemeComboBox.remove_all();
        }
    }

    _addComboBoxOption(value, label) {
        // Add an option to the ComboBox
        if (this.lightThemeComboBox) {
            this.lightThemeComboBox.add_option(label, value);
        }
        if (this.darkThemeComboBox) {
            this.darkThemeComboBox.add_option(label, value);
        }
    }

    _setDarkMode(dark) {
        let theme = dark ? (this._darkTheme) : this._lightTheme;
        let colorScheme = dark ? "prefer-dark" : "default";

        // Update settings
        let gtkSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
        gtkSettings.set_string("gtk-theme", theme);

        let cinnamonSettings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
        cinnamonSettings.set_string("gtk-theme", theme);

        let portalSettings = new Gio.Settings({ schema_id: "org.x.apps.portal" });
        portalSettings.set_string("color-scheme", colorScheme);

	this._darkMode = dark;
	this._populateThemeOptions();
    }

    on_change_theme(item) {
        this._setDarkMode(item.state);
    }

    on_settings_changed() {
        this._darkMode = this.settings.getValue("dark-mode");
        this._setDarkMode(this._darkMode);
    }

    on_applet_clicked(event) {
	this._setDarkMode(this._darkMode);
        this.menu.toggle();
    }

    _updateLabel() {
        if (this.disp_name) {
            this.set_applet_label(this._user.get_real_name());
            this._layoutBin.show();
        } else {
            this.set_applet_label("");
            this._layoutBin.hide();
        }
    }

    _onUserChanged() {
        if (this._user && this._user.is_loaded) {
            this.set_applet_tooltip(this._user.get_real_name());

            let hostname = GLib.get_host_name();
            this.hostLabel.set_text (`${GLib.get_user_name()}@${hostname}`);

            this.userLabel.set_text (this._user.get_real_name());
            if (this._userIcon) {
                this._userIcon.update();
                this._userIcon.show();
            }

            this._updatePanelIcon();
            this._updateLabel();
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
            this._panel_icon = new St.Icon({
                icon_name: 'avatar-default-symbolic',
                icon_type: St.IconType.SYMBOLIC,
                icon_size: this.getPanelIconSize(St.IconType.SYMBOLIC),
            });
            this._panel_icon_box.set_child(this._panel_icon);
        }
    }

    _setKeybinding() {
        if (this.keybindingId) {
            Main.keybindingManager.removeHotKey("user-applet-open-" + this.instance_id);
        }
        Main.keybindingManager.addHotKey("user-applet-open-" + this.instance_id, this.keyOpen, Lang.bind(this, this._openMenu));
    }

    _openMenu() {
        this.menu.toggle();
    }

    on_panel_height_changed() {
        this._updatePanelIcon();
    }

    on_panel_icon_size_changed() {
        this._updatePanelIcon();
    }

    on_applet_removed_from_panel() {
        this.settings.finalize();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CinnamonUserApplet(orientation, panel_height, instance_id);
}
