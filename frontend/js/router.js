/**
 * VROOM Client-Side Router
 * Manages view switching between Home, Predictor, Race Lab, and Methodology
 */

class VroomRouter {
  constructor() {
    this.routes = ["home", "predictor", "racelab", "methodology"];
    this.currentRoute = "home";
    this.init();
  }

  init() {
    // Listen to hashchange events
    window.addEventListener("hashchange", () => this.handleHash());

    // Listen to data-nav clicks
    document.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const target = el.getAttribute("data-nav");
        this.navigate(target);
      });
    });

    // Mobile menu toggle
    const toggle = document.querySelector(".mobile-menu-toggle");
    const navLinks = document.querySelector(".nav-links");
    if (toggle && navLinks) {
      toggle.addEventListener("click", () => {
        navLinks.classList.toggle("mobile-open");
      });
    }

    // Initial load
    this.handleHash();
  }

  handleHash() {
    const hash = window.location.hash.replace("#", "").toLowerCase();
    if (this.routes.includes(hash)) {
      this.setActiveView(hash);
    } else {
      this.setActiveView("home");
    }
  }

  navigate(route) {
    if (this.routes.includes(route)) {
      window.location.hash = route;
      // Close mobile menu if open
      const navLinks = document.querySelector(".nav-links");
      if (navLinks) navLinks.classList.remove("mobile-open");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  setActiveView(route) {
    this.currentRoute = route;

    // Update section visibility
    document.querySelectorAll(".view-section").forEach((sec) => {
      if (sec.id === `view-${route}`) {
        sec.classList.add("active");
      } else {
        sec.classList.remove("active");
      }
    });

    // Update nav buttons
    document.querySelectorAll(".nav-link-btn").forEach((btn) => {
      if (btn.getAttribute("data-nav") === route) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Fire custom event for view-specific re-renders (like charts)
    window.dispatchEvent(new CustomEvent("vroom:viewchange", { detail: { route } }));
  }
}

window.vroomRouter = new VroomRouter();
