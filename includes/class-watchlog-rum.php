<?php
/**
 * Watchlog RUM core plugin class.
 *
 * @package WatchlogRUM
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Main plugin class.
 */
class Watchlog_RUM_Plugin {
	const OPTION_NAME = 'watchlog_rum_settings';

	/**
	 * Singleton.
	 *
	 * @var Watchlog_RUM_Plugin|null
	 */
	private static $instance = null;

	/**
	 * Cached settings.
	 *
	 * @var array
	 */
	private $settings = array();

	/**
	 * Get instance.
	 *
	 * @return Watchlog_RUM_Plugin
	 */
	public static function get_instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Ctor.
	 */
	private function __construct() {
		$this->settings = $this->get_settings();

		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_menu', array( $this, 'register_settings_page' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
	}

	/**
	 * Define default settings.
	 *
	 * @return array
	 */
	private function get_default_settings() {
		return array(
			'api_key'                => '',
			'endpoint'               => '',
			'app'                    => '',
			'environment'            => '',
			'release'                => '',
			'sample_rate'            => 0.5,
			'network_sample_rate'    => 0.1,
			'interaction_sample_rate' => 0.1,
			'flush_interval'         => 10000,
			'session_timeout_minutes'=> 30,
			'enable_web_vitals'      => 1,
			'capture_long_tasks'     => 1,
			'capture_fetch'          => 1,
			'capture_xhr'            => 1,
			'capture_user_interactions' => 0,
			'capture_breadcrumbs'    => 1,
			'debug'                  => 0,
		);
	}

	/**
	 * Retrieve saved settings merged with defaults.
	 *
	 * @return array
	 */
	private function get_settings() {
		$saved = get_option( self::OPTION_NAME, array() );
		return wp_parse_args( $saved, $this->get_default_settings() );
	}

	/**
	 * Register settings and fields.
	 *
	 * @return void
	 */
	public function register_settings() {
		register_setting(
			'watchlog_rum',
			self::OPTION_NAME,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize_settings' ),
				'default'           => $this->get_default_settings(),
			)
		);

		add_settings_section(
			'watchlog_rum_general',
			__( 'Watchlog RUM Settings', 'watchlog-rum' ),
			function () {
				echo '<p>' . esc_html__( 'Configure your Watchlog RUM credentials and sampling options.', 'watchlog-rum' ) . '</p>';
			},
			'watchlog_rum'
		);

		foreach ( $this->get_fields() as $key => $field ) {
			add_settings_field(
				$key,
				esc_html( $field['label'] ),
				array( $this, 'render_field' ),
				'watchlog_rum',
				'watchlog_rum_general',
				array_merge( $field, array( 'key' => $key ) )
			);
		}
	}

	/**
	 * Fields definition.
	 *
	 * @return array[]
	 */
	private function get_fields() {
		return array(
			'api_key'                 => array(
				'label'       => __( 'API Key', 'watchlog-rum' ),
				'type'        => 'text',
				'description' => __( 'The Watchlog API key assigned to your project.', 'watchlog-rum' ),
				'required'    => true,
			),
			'endpoint'                => array(
				'label'       => __( 'Endpoint', 'watchlog-rum' ),
				'type'        => 'text',
				'description' => __( 'Your Watchlog RUM ingest endpoint URL.', 'watchlog-rum' ),
				'required'    => true,
			),
			'app'                     => array(
				'label'       => __( 'App Name', 'watchlog-rum' ),
				'type'        => 'text',
				'description' => __( 'Logical application name that appears in Watchlog.', 'watchlog-rum' ),
				'required'    => true,
			),
			'environment'             => array(
				'label'       => __( 'Environment', 'watchlog-rum' ),
				'type'        => 'text',
				'description' => __( 'Optional environment tag (production, staging, etc.).', 'watchlog-rum' ),
			),
			'release'                 => array(
				'label'       => __( 'Release', 'watchlog-rum' ),
				'type'        => 'text',
				'description' => __( 'Optional release or build identifier.', 'watchlog-rum' ),
			),
			'sample_rate'             => array(
				'label'       => __( 'Session Sample Rate', 'watchlog-rum' ),
				'type'        => 'number',
				'step'        => '0.05',
				'min'         => '0',
				'max'         => '1',
				'description' => __( 'Fraction of user sessions to capture (max 0.5 recommended).', 'watchlog-rum' ),
			),
			'network_sample_rate'     => array(
				'label'       => __( 'Network Sample Rate', 'watchlog-rum' ),
				'type'        => 'number',
				'step'        => '0.05',
				'min'         => '0',
				'max'         => '1',
				'description' => __( 'Sampling for fetch/XHR tracking.', 'watchlog-rum' ),
			),
			'interaction_sample_rate' => array(
				'label'       => __( 'Interaction Sample Rate', 'watchlog-rum' ),
				'type'        => 'number',
				'step'        => '0.05',
				'min'         => '0',
				'max'         => '1',
				'description' => __( 'Sampling for click/scroll tracking.', 'watchlog-rum' ),
			),
			'flush_interval'          => array(
				'label'       => __( 'Flush Interval (ms)', 'watchlog-rum' ),
				'type'        => 'number',
				'min'         => '1000',
				'step'        => '500',
				'description' => __( 'How often buffered events are sent.', 'watchlog-rum' ),
			),
			'session_timeout_minutes' => array(
				'label'       => __( 'Session Timeout (minutes)', 'watchlog-rum' ),
				'type'        => 'number',
				'min'         => '5',
				'step'        => '5',
				'description' => __( 'Minimum inactivity window before a new session is generated (default 30 minutes).', 'watchlog-rum' ),
			),
			'enable_web_vitals'       => array(
				'label'       => __( 'Enable Web Vitals', 'watchlog-rum' ),
				'type'        => 'checkbox',
				'description' => __( 'Capture CLS, LCP, INP, TTFB, and FID metrics.', 'watchlog-rum' ),
			),
			'capture_long_tasks'      => array(
				'label'       => __( 'Capture Long Tasks', 'watchlog-rum' ),
				'type'        => 'checkbox',
				'description' => __( 'Record long tasks (>50ms) using PerformanceObserver.', 'watchlog-rum' ),
			),
			'capture_fetch'           => array(
				'label'       => __( 'Capture Fetch', 'watchlog-rum' ),
				'type'        => 'checkbox',
				'description' => __( 'Instrument window.fetch calls.', 'watchlog-rum' ),
			),
			'capture_xhr'             => array(
				'label'       => __( 'Capture XHR', 'watchlog-rum' ),
				'type'        => 'checkbox',
				'description' => __( 'Instrument XMLHttpRequest calls.', 'watchlog-rum' ),
			),
			'capture_user_interactions' => array(
				'label'       => __( 'Capture User Interactions', 'watchlog-rum' ),
				'type'        => 'checkbox',
				'description' => __( 'Track sampled clicks, scroll depth, and form submissions.', 'watchlog-rum' ),
			),
			'capture_breadcrumbs'     => array(
				'label'       => __( 'Capture Breadcrumbs', 'watchlog-rum' ),
				'type'        => 'checkbox',
				'description' => __( 'Attach last breadcrumbs to each event.', 'watchlog-rum' ),
			),
			'debug'                   => array(
				'label'       => __( 'Debug Logging', 'watchlog-rum' ),
				'type'        => 'checkbox',
				'description' => __( 'Output verbose logs to the browser console.', 'watchlog-rum' ),
			),
		);
	}

	/**
	 * Render settings field.
	 *
	 * @param array $field Field config.
	 * @return void
	 */
	public function render_field( $field ) {
		$key     = $field['key'];
		$value   = isset( $this->settings[ $key ] ) ? $this->settings[ $key ] : '';
		$type    = isset( $field['type'] ) ? $field['type'] : 'text';
		$desc    = isset( $field['description'] ) ? $field['description'] : '';
		$required= isset( $field['required'] ) ? (bool) $field['required'] : false;
		$step    = isset( $field['step'] ) ? esc_attr( $field['step'] ) : '';
		$min     = isset( $field['min'] ) ? esc_attr( $field['min'] ) : '';
		$max     = isset( $field['max'] ) ? esc_attr( $field['max'] ) : '';

		switch ( $type ) {
			case 'number':
				$step_attr = $step ? sprintf( ' step="%s"', $step ) : ' step="0.1"';
				$min_attr  = $min ? sprintf( ' min="%s"', $min ) : '';
				$max_attr  = $max ? sprintf( ' max="%s"', $max ) : '';
				printf(
					'<input type="number" name="%1$s[%2$s]" id="%2$s" value="%3$s"%4$s%5$s%6$s class="regular-text" %7$s />',
					esc_attr( self::OPTION_NAME ),
					esc_attr( $key ),
					esc_attr( $value ),
					$step_attr,
					$min_attr,
					$max_attr,
					$required ? 'required' : ''
				);
				break;
			case 'checkbox':
				printf(
					'<label><input type="checkbox" name="%1$s[%2$s]" id="%2$s" value="1" %3$s /> %4$s</label>',
					esc_attr( self::OPTION_NAME ),
					esc_attr( $key ),
					checked( (bool) $value, true, false ),
					esc_html__( 'Enabled', 'watchlog-rum' )
				);
				break;
			default:
				printf(
					'<input type="text" name="%1$s[%2$s]" id="%2$s" value="%3$s" class="regular-text" %4$s />',
					esc_attr( self::OPTION_NAME ),
					esc_attr( $key ),
					esc_attr( $value ),
					$required ? 'required' : ''
				);
				break;
		}

		if ( ! empty( $desc ) ) {
			printf( '<p class="description">%s</p>', esc_html( $desc ) );
		}
	}

	/**
	 * Sanitize settings.
	 *
	 * @param array $input Raw input.
	 * @return array
	 */
	public function sanitize_settings( $input ) {
		$clean   = $this->get_default_settings();
		$input   = is_array( $input ) ? $input : array();

		$clean['api_key']  = sanitize_text_field( $input['api_key'] ?? '' );
		$clean['endpoint'] = esc_url_raw( $input['endpoint'] ?? '' );
		$clean['app']      = sanitize_text_field( $input['app'] ?? '' );
		$clean['environment'] = sanitize_text_field( $input['environment'] ?? '' );
		$clean['release']     = sanitize_text_field( $input['release'] ?? '' );

		$clean['sample_rate'] = $this->clamp_fraction( $input['sample_rate'] ?? 0.5 );
		$clean['network_sample_rate'] = $this->clamp_fraction( $input['network_sample_rate'] ?? 0.1 );
		$clean['interaction_sample_rate'] = $this->clamp_fraction( $input['interaction_sample_rate'] ?? 0.1 );

		$clean['flush_interval'] = max( 1000, absint( $input['flush_interval'] ?? 10000 ) );
		$clean['session_timeout_minutes'] = $this->sanitize_session_timeout( $input['session_timeout_minutes'] ?? 30 );

		$flags = array(
			'enable_web_vitals',
			'capture_long_tasks',
			'capture_fetch',
			'capture_xhr',
			'capture_user_interactions',
			'capture_breadcrumbs',
			'debug',
		);
		foreach ( $flags as $flag ) {
			$clean[ $flag ] = empty( $input[ $flag ] ) ? 0 : 1;
		}

		$this->settings = $clean;

		return $clean;
	}

	/**
	 * Clamp helper.
	 *
	 * @param mixed $value Value.
	 * @return float
	 */
	private function clamp_fraction( $value ) {
		$number = floatval( $value );
		if ( $number < 0 ) {
			$number = 0;
		}
		if ( $number > 1 ) {
			$number = 1;
		}
		return $number;
	}

	/**
	 * Normalize session timeout (in minutes).
	 *
	 * @param mixed $value Raw timeout value.
	 * @return int
	 */
	private function sanitize_session_timeout( $value ) {
		$minutes = absint( $value );
		if ( $minutes < 5 ) {
			$minutes = 5;
		}
		if ( $minutes > 1440 ) {
			$minutes = 1440;
		}
		return $minutes;
	}

	/**
	 * Register settings page.
	 *
	 * @return void
	 */
	public function register_settings_page() {
		add_options_page(
			__( 'Watchlog RUM', 'watchlog-rum' ),
			__( 'Watchlog RUM', 'watchlog-rum' ),
			'manage_options',
			'watchlog-rum',
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Render admin page.
	 *
	 * @return void
	 */
	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Watchlog RUM', 'watchlog-rum' ); ?></h1>
			<form action="options.php" method="post">
				<?php
				settings_fields( 'watchlog_rum' );
				do_settings_sections( 'watchlog_rum' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}

	/**
	 * Maybe enqueue frontend assets.
	 *
	 * @return void
	 */
	public function enqueue_assets() {
		if ( is_admin() ) {
			return;
		}
		if ( empty( $this->settings['api_key'] ) || empty( $this->settings['endpoint'] ) || empty( $this->settings['app'] ) ) {
			return;
		}

		$deps = array();
		if ( ! empty( $this->settings['enable_web_vitals'] ) ) {
			wp_register_script(
				'watchlog-web-vitals',
				WATCHLOG_RUM_PLUGIN_URL . 'assets/js/web-vitals.iife.js',
				array(),
				'4.0.0',
				true
			);
			$deps[] = 'watchlog-web-vitals';
		}

		wp_register_script(
			'watchlog-rum',
			WATCHLOG_RUM_PLUGIN_URL . 'assets/js/watchlog-rum.js',
			$deps,
			WATCHLOG_RUM_VERSION,
			true
		);

		$config = array(
			'apiKey'                 => $this->settings['api_key'],
			'endpoint'               => $this->settings['endpoint'],
			'app'                    => $this->settings['app'],
			'environment'            => $this->settings['environment'],
			'release'                => $this->settings['release'],
			'sampleRate'             => $this->settings['sample_rate'],
			'networkSampleRate'      => $this->settings['network_sample_rate'],
			'interactionSampleRate'  => $this->settings['interaction_sample_rate'],
			'flushInterval'          => $this->settings['flush_interval'],
			'sessionTimeoutMinutes'  => $this->settings['session_timeout_minutes'],
			'enableWebVitals'        => (bool) $this->settings['enable_web_vitals'],
			'captureLongTasks'       => (bool) $this->settings['capture_long_tasks'],
			'captureFetch'           => (bool) $this->settings['capture_fetch'],
			'captureXHR'             => (bool) $this->settings['capture_xhr'],
			'captureUserInteractions'=> (bool) $this->settings['capture_user_interactions'],
			'captureBreadcrumbs'     => (bool) $this->settings['capture_breadcrumbs'],
			'debug'                  => (bool) $this->settings['debug'],
			'normalizedPath'         => $this->get_normalized_path(),
			'routeHints'             => $this->get_route_hints(),
			'pageLoadTimestamp'      => time(),
		);

		wp_localize_script(
			'watchlog-rum',
			'WatchlogRUMWPConfig',
			$config
		);

		wp_enqueue_script( 'watchlog-rum' );
	}

	/**
	 * Build normalized path for current request.
	 *
	 * @return string
	 */
	private function get_normalized_path() {
		if ( is_front_page() ) {
			return '/';
		}

		if ( is_home() && ! is_front_page() ) {
			$posts_page = (int) get_option( 'page_for_posts' );
			$permalink  = $posts_page ? get_permalink( $posts_page ) : '';
			$relative   = $permalink ? wp_make_link_relative( $permalink ) : '';
			return $this->format_path( $relative ?: '/blog' );
		}

		if ( is_singular() ) {
			$post = get_queried_object();
			if ( $post instanceof WP_Post ) {
				return $this->normalize_post_path( $post );
			}
		}

		if ( is_category() ) {
			$base = get_option( 'category_base' );
			$base = $base ? $base : 'category';
			return $this->format_path( trailingslashit( $base ) . ':slug' );
		}

		if ( is_tag() ) {
			$base = get_option( 'tag_base' );
			$base = $base ? $base : 'tag';
			return $this->format_path( trailingslashit( $base ) . ':slug' );
		}

		if ( is_tax() ) {
			$term = get_queried_object();
			if ( $term instanceof WP_Term ) {
				$tax = get_taxonomy( $term->taxonomy );
				if ( $tax && ! empty( $tax->rewrite['slug'] ) ) {
					return $this->format_path( trailingslashit( $tax->rewrite['slug'] ) . ':slug' );
				}
			}
		}

		if ( is_post_type_archive() ) {
			$post_type = get_query_var( 'post_type' );
			$post_type = is_array( $post_type ) ? reset( $post_type ) : $post_type;
			if ( $post_type ) {
				$obj = get_post_type_object( $post_type );
				if ( $obj && $obj->has_archive ) {
					$slug = true === $obj->has_archive ? $obj->rewrite['slug'] : $obj->has_archive;
					return $this->format_path( $slug );
				}
			}
		}

		if ( is_author() ) {
			global $wp_rewrite;
			$base = ! empty( $wp_rewrite->author_base ) ? $wp_rewrite->author_base : 'author';
			return $this->format_path( trailingslashit( $base ) . ':author' );
		}

		if ( is_date() ) {
			$segments = array();
			if ( get_query_var( 'year' ) ) {
				$segments[] = ':year';
			}
			if ( get_query_var( 'monthnum' ) ) {
				$segments[] = ':month';
			}
			if ( get_query_var( 'day' ) ) {
				$segments[] = ':day';
			}
			$base = implode( '/', $segments );
			return $base ? '/' . $base : $this->format_path( $this->get_current_path() );
		}

		if ( is_search() ) {
			return '/search/:term';
		}

		if ( is_404() ) {
			return '/404';
		}

		$path = $this->get_current_path();
		return $this->format_path( $path );
	}

	/**
	 * Format path helper.
	 *
	 * @param string $path Route path.
	 * @return string
	 */
	private function format_path( $path ) {
		$path = $path ?: '/';
		$path = '/' . ltrim( $path, '/' );
		if ( '/' !== $path ) {
			$path = rtrim( $path, '/' );
		}
		return $path ?: '/';
	}

	/**
	 * Get current request path.
	 *
	 * @return string
	 */
	private function get_current_path() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/';
		$path = strtok( $uri, '?' );
		return $path ?: '/';
	}

	/**
	 * Normalize singular post/page path.
	 *
	 * @param WP_Post $post Post.
	 * @return string
	 */
	private function normalize_post_path( WP_Post $post ) {
		global $wp_rewrite;

		$structure = '';
		if ( 'page' === $post->post_type ) {
			$path = wp_make_link_relative( get_permalink( $post ) );
			return $this->format_path( $path ?: $this->get_current_path() );
		}

		if ( 'post' === $post->post_type ) {
			$structure = get_option( 'permalink_structure' );
		} else {
			$structure = $wp_rewrite->get_extra_permastruct( $post->post_type );
			if ( ! $structure && ! empty( $post->post_type ) ) {
				$structure = '/' . $post->post_type . '/%postname%';
			}
		}

		if ( $structure ) {
			$pattern = $this->structure_to_pattern( $structure );
			if ( $pattern ) {
				return $pattern;
			}
		}

		// Fallback: replace last segment with :slug.
		$path     = $this->get_current_path();
		$segments = array_values( array_filter( explode( '/', trim( $path, '/' ) ) ) );
		if ( empty( $segments ) ) {
			return '/';
		}

		$segments[ count( $segments ) - 1 ] = ':slug';

		return '/' . implode( '/', $segments );
	}

	/**
	 * Convert permastruct to normalized path pattern.
	 *
	 * @param string $structure Permalink structure.
	 * @return string|null
	 */
	private function structure_to_pattern( $structure ) {
		if ( empty( $structure ) ) {
			return null;
		}

		$map = $this->get_pattern_map();
		$pattern = $structure;

		foreach ( $map as $placeholder => $replacement ) {
			$pattern = str_replace( $placeholder, $replacement['token'], $pattern );
		}

		$pattern = $this->format_path( $pattern );
		return $pattern;
	}

	/**
	 * Generate route hints for JS normalization.
	 *
	 * @return array
	 */
	private function get_route_hints() {
		global $wp_rewrite;

		$hints = array();
		$post_struct = get_option( 'permalink_structure' );
		if ( $post_struct ) {
			$hints[] = $this->build_hint( 'post', $post_struct );
		}

		$post_types = get_post_types(
			array(
				'public'   => true,
				'_builtin' => false,
			),
			'objects'
		);
		foreach ( $post_types as $obj ) {
			$struct = $wp_rewrite->get_extra_permastruct( $obj->name );
			if ( ! $struct && ! empty( $obj->rewrite['slug'] ) ) {
				$struct = '/' . $obj->rewrite['slug'] . '/%postname%';
			}
			if ( $struct ) {
				$hints[] = $this->build_hint( $obj->name, $struct );
			}
		}

		$taxonomies = get_taxonomies(
			array(
				'public' => true,
			),
			'objects'
		);
		foreach ( $taxonomies as $tax ) {
			if ( empty( $tax->rewrite['slug'] ) ) {
				continue;
			}
			$struct  = '/' . trim( $tax->rewrite['slug'], '/' ) . '/%term%';
			$pattern = $this->structure_to_pattern( $struct );
			$regex   = $this->structure_to_regex( $struct );
			if ( $pattern && $regex ) {
				$hints[] = array(
					'type'    => 'taxonomy',
					'pattern' => $pattern,
					'regex'   => $regex,
				);
			}
		}

		$author_base = ! empty( $wp_rewrite->author_base ) ? $wp_rewrite->author_base : 'author';
		$hints[]     = array(
			'type'    => 'author',
			'pattern' => $this->format_path( $author_base . '/:author' ),
			'regex'   => '^' . preg_quote( trim( $author_base, '/' ), '/' ) . '\/[^\/]+\/?$',
		);

		$hints[] = array(
			'type'    => 'search',
			'pattern' => '/search/:term',
			'regex'   => '^search\/.+$',
		);

		return array_values( array_filter( $hints ) );
	}

	/**
	 * Build hint entry.
	 *
	 * @param string $type Type.
	 * @param string $structure Permastruct.
	 * @return array|null
	 */
	private function build_hint( $type, $structure ) {
		$pattern = $this->structure_to_pattern( $structure );
		$regex   = $this->structure_to_regex( $structure );
		if ( ! $pattern || ! $regex ) {
			return null;
		}
		return array(
			'type'    => $type,
			'pattern' => $pattern,
			'regex'   => $regex,
		);
	}

	/**
	 * Convert structure to regex.
	 *
	 * @param string $structure Structure.
	 * @return string|null
	 */
	private function structure_to_regex( $structure ) {
		if ( empty( $structure ) ) {
			return null;
		}
		$map   = $this->get_pattern_map();
		$regex = trim( $structure, '/' );

		foreach ( $map as $placeholder => $replacement ) {
			$regex = str_replace( $placeholder, $replacement['regex'], $regex );
		}
		$regex = str_replace( '/', '\/', $regex );
		return '^' . $regex . '\/?$';
	}

	/**
	 * Placeholder map.
	 *
	 * @return array
	 */
	private function get_pattern_map() {
		return array(
			'%postname%'  => array(
				'token' => ':postname',
				'regex' => '[^\/]+',
			),
			'%pagename%'  => array(
				'token' => ':pagename',
				'regex' => '.+',
			),
			'%post_id%'   => array(
				'token' => ':post_id',
				'regex' => '[0-9]+',
			),
			'%year%'      => array(
				'token' => ':year',
				'regex' => '[0-9]{4}',
			),
			'%monthnum%'  => array(
				'token' => ':month',
				'regex' => '[0-9]{1,2}',
			),
			'%day%'       => array(
				'token' => ':day',
				'regex' => '[0-9]{1,2}',
			),
			'%hour%'      => array(
				'token' => ':hour',
				'regex' => '[0-9]{1,2}',
			),
			'%minute%'    => array(
				'token' => ':minute',
				'regex' => '[0-9]{1,2}',
			),
			'%second%'    => array(
				'token' => ':second',
				'regex' => '[0-9]{1,2}',
			),
			'%author%'    => array(
				'token' => ':author',
				'regex' => '[^\/]+',
			),
			'%category%'  => array(
				'token' => ':category',
				'regex' => '.+',
			),
			'%post_type%' => array(
				'token' => ':post_type',
				'regex' => '[^\/]+',
			),
			'%term%'      => array(
				'token' => ':slug',
				'regex' => '[^\/]+',
			),
		);
	}
}
