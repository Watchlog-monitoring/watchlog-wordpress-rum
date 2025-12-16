<?php
/**
 * Plugin Name: Watchlog RUM
 * Description: Real User Monitoring for WordPress sites powered by Watchlog. Mirrors the Vue/React SDK event format.
 * Version: 0.1.0
 * Author: Watchlog
 * License: GPL2+
 * Text Domain: watchlog-rum
 *
 * @package WatchlogRUM
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'WATCHLOG_RUM_VERSION', '0.1.0' );
define( 'WATCHLOG_RUM_PLUGIN_FILE', __FILE__ );
define( 'WATCHLOG_RUM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'WATCHLOG_RUM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once WATCHLOG_RUM_PLUGIN_DIR . 'includes/class-watchlog-rum.php';

/**
 * Initialize plugin.
 *
 * @return void
 */
function watchlog_rum_bootstrap() {
	if ( class_exists( 'Watchlog_RUM_Plugin' ) ) {
		Watchlog_RUM_Plugin::get_instance();
	}
}
add_action( 'plugins_loaded', 'watchlog_rum_bootstrap' );
